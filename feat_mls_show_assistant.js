/* feat_mls_show_assistant.js  ->  window.__mlsShowAsst  (sa-1.0.0)
 * --------------------------------------------------------------------------
 * MLS ASSISTANT - "SHOW MLS ASSISTANT" (TEACH THE WRITEBACK LOCATION BY SHOWING IT)
 *
 * Adds a "Show MLS Assistant" option to the Writeback Destination panel
 * (item61, window.__mlsWbConsole). Instead of picking a destination from
 * dropdowns, the doctor enters a teach-by-demonstration mode: the assistant
 * OBSERVES while the doctor navigates/clicks to the exact note section/field
 * in athenaOne where MLS should write. It captures that target as a robust
 * selector + section label, saves it as the writeback destination through the
 * EXISTING writeback router (window.__mlsWbRouter.setTarget, per-doctor
 * localStorage, no PHI), confirms ("Learned: <target>"), and offers clear/
 * re-teach. Future writebacks then read that destination from the router like
 * any other preference.
 *
 * STRICT GUARANTEES
 *  - OBSERVING / LEARNING IS READ-ONLY. Teach mode NEVER types, clicks-through,
 *    pastes, writes or signs anything. The in-app capture listens in the capture
 *    phase and does NOT preventDefault / stopPropagation - it only records.
 *  - It introduces NO new write path. Any actual write/sign that later uses the
 *    learned target still goes through item61's existing USER-INITIATED,
 *    name+DOB-gated writers (__mlsOpWb / __mlsAthenaWriteback / Sign & Save).
 *  - Stores only routing labels + a DOM selector string (no PHI).
 *  - Additive, idempotent, reversible (window.__mlsShowAsst.revert()). ASCII-only.
 *
 * HONEST STATUS (capturing a robust athenaOne selector is the hard part):
 *  athenaOne runs inside the MLS Assist EXTENSION's context, not this app page.
 *  So the app side asks the extension to observe via the same ping-gated bridge
 *  the writeback modules use (request 'mlsAppTeachStart' -> 'mlsAppTeachResult').
 *   - If the installed MLS Assist HAS that observer handler, the captured target
 *     is the real athenaOne element (selector + label) -> fully wired end-to-end.
 *   - If it does NOT have the handler yet (likely today), the module falls back
 *     to an in-app capture (clicks reachable in THIS page) and clearly reports
 *     that the athenaOne-side observer is pending in the extension. It never
 *     pretends it learned an athenaOne target it could not actually read.
 *  Either way the learned section label is written into the router's sectionName
 *  so the CURRENT section-name-based writeback honors it immediately; the raw
 *  selector is stored as taughtSelector for a future selector-aware writer.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsShowAsst && window.__mlsShowAsst.installed) return; } catch (e) { return; }

  var VERSION = 'sa-1.0.0';
  var ASSET = 'feat_mls_show_assistant.js';
  var STYLE_ID = 'mlsShowAsstStyle';
  var PANEL_ID = 'mlsShowAsstPanel';
  var BANNER_ID = 'mlsShowAsstBanner';
  var BTN_CLASS = 'mls-showasst-btn';

  /* ---------------- tiny utils ---------------- */
  function win(n) { try { return window[n]; } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function router() { return win('__mlsWbRouter'); }

  /* ---------------- the kinds we can teach a destination for ---------------- */
  var KINDS = [
    { key: 'note', label: 'Clinical note' },
    { key: 'opnote', label: 'Op-note / injection procedure note' },
    { key: 'dx', label: 'Diagnoses (ICD-10)' },
    { key: 'cpt', label: 'Billing / CPT codes' }
  ];
  function kindLabel(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].key === k) return KINDS[i].label; return k; }

  /* ================================================================
   *  ROBUST SELECTOR / LABEL CAPTURE (for in-app fallback targets)
   * ================================================================ */
  function isStableId(id) {
    if (!id) return false;
    // reject ids that look auto-generated (long hex/digit runs, framework keys)
    if (/^(ember|react|radix|mui|:r|__)/i.test(id)) return false;
    if (/[0-9a-f]{8,}/i.test(id)) return false;
    if (/\d{4,}/.test(id)) return false;
    return true;
  }
  function nthOfType(el) {
    var i = 1, sib = el;
    while ((sib = sib.previousElementSibling)) { if (sib.tagName === el.tagName) i++; }
    return i;
  }
  function cssEscape(s) {
    if (window.CSS && isFn(window.CSS.escape)) return safe(function () { return window.CSS.escape(s); }, String(s));
    return String(s).replace(/["\\\]\[#.:>+~*^$=|()]/g, '\\$&');
  }
  function oneStep(el) {
    var tag = (el.tagName || '').toLowerCase();
    if (el.id && isStableId(el.id)) return '#' + cssEscape(el.id);
    var stableAttrs = ['data-testid', 'data-test', 'data-qa', 'data-section', 'data-field', 'name', 'aria-label'];
    for (var i = 0; i < stableAttrs.length; i++) {
      var a = stableAttrs[i], v = safe(function () { return el.getAttribute(a); }, null);
      if (v && trim(v) && trim(v).length < 64) return tag + '[' + a + '="' + cssEscape(trim(v)) + '"]';
    }
    return tag + ':nth-of-type(' + nthOfType(el) + ')';
  }
  function computeSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && isStableId(el.id)) return '#' + cssEscape(el.id);
    var parts = [], node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var step = oneStep(node);
      parts.unshift(step);
      if (step.charAt(0) === '#') break; // anchored on a stable id - good enough
      node = node.parentElement; depth++;
    }
    return parts.join(' > ');
  }
  function labelFor(el) {
    if (!el || el.nodeType !== 1) return '';
    var cands = [
      safe(function () { return el.getAttribute('aria-label'); }, ''),
      safe(function () { return el.getAttribute('placeholder'); }, ''),
      safe(function () { return el.getAttribute('title'); }, ''),
      safe(function () { return el.getAttribute('name'); }, '')
    ];
    if (el.id) safe(function () {
      var lb = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (lb) cands.push(lb.textContent);
    });
    safe(function () {
      var p = el.closest('section,fieldset,[role="group"],div');
      if (p) {
        var h = p.querySelector('legend,h1,h2,h3,h4,label,.wbc-grp h3');
        if (h) cands.push(h.textContent);
      }
    });
    var own = safe(function () { return trim(el.textContent); }, '');
    if (own && own.length <= 48) cands.push(own);
    for (var i = 0; i < cands.length; i++) {
      var c = trim(cands[i]).replace(/\s+/g, ' ');
      if (c && c.length >= 2 && c.length <= 64) return c;
    }
    return (el.tagName || 'element').toLowerCase();
  }
  function buildPath(el) {
    var out = [], node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      out.unshift({ tag: (node.tagName || '').toLowerCase(), id: node.id || '', cls: trim(node.className && node.className.baseVal != null ? node.className.baseVal : node.className) });
      node = node.parentElement; depth++;
    }
    return out;
  }
  function describeTarget(t) {
    if (!t) return '(nothing captured)';
    return trim(t.label) || trim(t.sectionName) || trim(t.selector) || '(unnamed target)';
  }

  /* ================================================================
   *  PING-GATED BRIDGE TO MLS ASSIST (observe-only request)
   *  Same protocol as the writeback modules. This NEVER writes; it only
   *  asks the extension to OBSERVE the next athenaOne click and report it.
   * ================================================================ */
  function bridgeTeach(kind, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false, ponged = false, tries = 0, iv = null, to = null;
      function cleanup() { try { window.removeEventListener('message', onMsg); } catch (e) {} if (iv) clearInterval(iv); if (to) clearTimeout(to); }
      function finish(resp) { if (done) return; done = true; cleanup(); resolve(resp || {}); }
      function onMsg(e) {
        var d = e && e.data; if (!d || d.source !== 'mls-ext') return;
        if (d.type === 'mlsPong' && !ponged) { ponged = true; if (iv) clearInterval(iv); send(); return; }
        if (d.type === 'mlsAppTeachResult') finish(d.resp || { error: 'no response' });
      }
      function send() { safe(function () { window.postMessage({ source: 'mls-app', type: 'mlsAppTeachStart', kind: kind, mode: 'observe' }, '*'); }); }
      function ping() { safe(function () { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); }); }
      window.addEventListener('message', onMsg);
      ping();
      iv = setInterval(function () { tries++; if (ponged) { clearInterval(iv); return; } if (tries > 8) { clearInterval(iv); finish({ error: 'noext' }); } else ping(); }, 350);
      to = setTimeout(function () { finish({ error: ponged ? 'teach-unsupported' : 'timeout' }); }, timeoutMs || 60000);
    });
  }

  /* ================================================================
   *  STATE
   * ================================================================ */
  var teaching = false;
  var teachKind = 'note';
  var inAppListener = null;
  var bridgePromise = null;

  /* ================================================================
   *  PERSISTENCE - write the learned target through the EXISTING router
   *  (per-doctor localStorage). We also write the human label into
   *  sectionName so the current section-name-based writeback honors it now;
   *  the raw selector is kept as taughtSelector for a selector-aware writer.
   * ================================================================ */
  function lsKey() {
    var r = router(); var id = (r && isFn(r.doctorId)) ? safe(function () { return r.doctorId(); }, 'default') : 'default';
    return 'mlsWbPrefs:' + (id || 'default');
  }
  function loadPrefs() { return safe(function () { var raw = localStorage.getItem(lsKey()); return raw ? (JSON.parse(raw) || {}) : {}; }, {}); }
  function savePrefs(p) { safe(function () { localStorage.setItem(lsKey(), JSON.stringify(p || {})); }); }

  function persistLearned(kind, target) {
    var r = router();
    var patch = {
      taughtSelector: trim(target.selector),
      taughtPath: safe(function () { return JSON.stringify(target.path || []); }, '[]'),
      taughtLabel: trim(target.label) || trim(target.sectionName),
      taughtVia: target.via || 'inapp',
      taughtFrame: target.frame || 'app',
      taughtAt: new Date().toISOString(),
      taughtBy: 'show'
    };
    var lbl = trim(target.label) || trim(target.sectionName);
    if (lbl) { patch.sectionName = lbl; patch.taughtSetSectionName = '1'; }
    if (r && isFn(r.setTarget)) { safe(function () { r.setTarget(kind, patch); }); return true; }
    // router missing: store directly under the same key scheme so it is not lost
    var p = loadPrefs(); var cur = p[kind] || {};
    for (var k in patch) if (patch.hasOwnProperty(k)) cur[k] = patch[k];
    p[kind] = cur; savePrefs(p);
    return false;
  }
  function learnedFor(kind) {
    var r = router();
    var t = (r && isFn(r.get)) ? safe(function () { return r.get(kind); }, null) : null;
    if (!t) { var p = loadPrefs(); t = p[kind] || null; }
    if (!t || (!trim(t.taughtSelector) && !trim(t.taughtLabel))) return null;
    return {
      label: trim(t.taughtLabel) || trim(t.sectionName),
      selector: trim(t.taughtSelector),
      via: trim(t.taughtVia),
      frame: trim(t.taughtFrame),
      at: trim(t.taughtAt)
    };
  }
  function clearLearned(kind) {
    // Remove only the taught* keys for this kind (and sectionName if WE set it),
    // leaving any non-taught manual preferences intact.
    var p = loadPrefs(); var cur = p[kind]; if (!cur) return;
    var taughtKeys = ['taughtSelector', 'taughtPath', 'taughtLabel', 'taughtVia', 'taughtFrame', 'taughtAt', 'taughtBy'];
    var hadSetSection = cur.taughtSetSectionName === '1';
    for (var i = 0; i < taughtKeys.length; i++) delete cur[taughtKeys[i]];
    if (hadSetSection) delete cur.sectionName;
    delete cur.taughtSetSectionName;
    p[kind] = cur; savePrefs(p);
  }

  /* ================================================================
   *  TEACH FLOW (read-only observe)
   * ================================================================ */
  function showBanner(html, tone) {
    var b = $(BANNER_ID);
    if (!b) {
      b = document.createElement('div'); b.id = BANNER_ID; b.setAttribute('data-mls-showasst', '1');
      (document.body || document.documentElement).appendChild(b);
    }
    b.className = (tone || '');
    b.innerHTML = html;
  }
  function hideBanner() { var b = $(BANNER_ID); if (b && b.parentNode) b.parentNode.removeChild(b); }

  function wireCancel() {
    safe(function () {
      var c = document.querySelector('#' + BANNER_ID + ' .mls-showasst-cancel');
      if (c) c.addEventListener('click', function () { cancelTeach('You cancelled. Nothing was captured or changed.'); });
    });
  }

  function startTeach(kind) {
    if (teaching) return;
    kind = kind || teachKind || 'note';
    teachKind = kind;
    teaching = true;

    showBanner(
      '<b>Show MLS Assistant - watching (read-only).</b> ' +
      'Go to athenaOne and click the exact note section/field where MLS should write the <b>' + esc(kindLabel(kind)) + '</b>. ' +
      'I am only observing - I will not type, click through, or change anything. ' +
      '<button type="button" class="mls-showasst-cancel">Cancel</button>',
      'watch'
    );
    wireCancel();

    // 1) Ask the extension to observe the real athenaOne click (preferred, end-to-end).
    bridgePromise = bridgeTeach(kind, 60000).then(function (resp) {
      if (!teaching) return; // already resolved by in-app capture or cancel
      resp = resp || {};
      if (resp.ok && resp.target && (trim(resp.target.selector) || trim(resp.target.label) || trim(resp.target.sectionName))) {
        finishTeach(kind, {
          selector: trim(resp.target.selector),
          label: trim(resp.target.label || resp.target.sectionName),
          sectionName: trim(resp.target.sectionName || resp.target.label),
          path: resp.target.path || [],
          via: 'extension', frame: 'athena'
        });
        return;
      }
      var why = resp.error === 'noext' ? 'MLS Assist is not responding'
        : resp.error === 'timeout' ? 'no athenaOne click was observed in time'
        : resp.error === 'teach-unsupported' ? 'this MLS Assist build does not have the athenaOne observer yet'
        : ('the observer did not confirm (' + (resp.error || 'unknown') + ')');
      if (teaching) {
        showBanner(
          '<b>Still watching (read-only).</b> The athenaOne-side observer is unavailable (' + esc(why) + '). ' +
          'You can still teach an <i>in-page</i> target by clicking it here, or Cancel and try again after the extension ships the observer. ' +
          '<button type="button" class="mls-showasst-cancel">Cancel</button>',
          'warn'
        );
        wireCancel();
      }
    });

    // 2) In-app fallback: observe the next click in THIS page (read-only; does not block).
    inAppListener = function (ev) {
      if (!teaching) return;
      var el = ev.target;
      if (el && el.closest && el.closest('[data-mls-showasst],#' + PANEL_ID + ',#' + BANNER_ID)) return; // ignore our own UI
      if (!el || el.nodeType !== 1) return;
      finishTeach(kind, {
        selector: computeSelector(el),
        label: labelFor(el),
        sectionName: labelFor(el),
        path: safe(function () { return buildPath(el); }, []),
        via: 'inapp', frame: 'app'
      });
    };
    // capture phase, passive - we observe but never preventDefault / stopPropagation
    safe(function () { document.addEventListener('click', inAppListener, { capture: true, passive: true }); });
  }

  function teardownListeners() {
    if (inAppListener) { safe(function () { document.removeEventListener('click', inAppListener, { capture: true }); }); inAppListener = null; }
    bridgePromise = null;
  }

  function finishTeach(kind, target) {
    if (!teaching) return;
    teaching = false;
    teardownListeners();

    var routerOk = persistLearned(kind, target);
    var where = describeTarget(target);
    var viaTxt = target.via === 'extension'
      ? 'captured from athenaOne'
      : 'captured in-page (athenaOne observer pending in the extension)';
    var savedTxt = routerOk
      ? 'Saved as the writeback destination (per-doctor, no PHI).'
      : 'Stored locally (the writeback router was not loaded - reload to share it with all write paths).';

    showBanner(
      '<b>Learned: ' + esc(where) + '</b> for <b>' + esc(kindLabel(kind)) + '</b> &mdash; ' + esc(viaTxt) + '. ' +
      esc(savedTxt) + ' Future ' + esc(kindLabel(kind)) + ' writebacks target here (still name+DOB gated, user-initiated). ' +
      '<button type="button" class="mls-showasst-dismiss">OK</button>',
      'ok'
    );
    safe(function () {
      var d = document.querySelector('#' + BANNER_ID + ' .mls-showasst-dismiss');
      if (d) d.addEventListener('click', hideBanner);
    });
    setTimeout(function () { safe(function () { var b = $(BANNER_ID); if (b && /Learned:/.test(b.textContent)) hideBanner(); }); }, 12000);

    notify(target.via === 'extension'
      ? ('Learned "' + where + '" as the ' + kindLabel(kind) + ' writeback destination from athenaOne.')
      : ('Learned "' + where + '" (in-page) as the ' + kindLabel(kind) + ' destination; the athenaOne-side observer is pending in MLS Assist.'),
      'done');

    refreshPanel();
  }

  function cancelTeach(msg) {
    teaching = false;
    teardownListeners();
    hideBanner();
    if (msg) notify(msg, 'note');
    refreshPanel();
  }

  /* surface short status into the app's timeline/toast if available */
  function notify(text, state) {
    var a = win('__mlsAthenaActions');
    if (a && isFn(a._step)) { safe(function () { a._step(text, state); }); return; }
    var t = win('toast'); if (isFn(t)) safe(function () { t(String(text), (state === 'fail' || state === 'warn') ? 'err' : ''); });
  }

  /* ================================================================
   *  THE "SHOW MLS ASSISTANT" PANEL (own small modal)
   * ================================================================ */
  function ensureStyle() {
    if ($(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent =
      '.' + BTN_CLASS + '{cursor:pointer;font-weight:600;font-size:12px;padding:7px 12px;border-radius:9px;border:1px solid #7A5CC0;background:#ede9fe;color:#2E6A4B;margin-top:8px;margin-left:8px}' +
      '#' + PANEL_ID + '{position:fixed;inset:0;z-index:2147483601;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45)}' +
      '#' + PANEL_ID + ' .sa-card{background:#fff;color:#0f172a;width:min(560px,94vw);max-height:88vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}' +
      '#' + PANEL_ID + ' .sa-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid #e2e8f0}' +
      '#' + PANEL_ID + ' .sa-hd h2{margin:0;font-size:16px}' +
      '#' + PANEL_ID + ' .sa-hd .sa-sub{margin-top:3px;font-size:12px;color:#64748b}' +
      '#' + PANEL_ID + ' .sa-x{cursor:pointer;border:1px solid #cbd5e1;background:#FCFBF8;border-radius:8px;padding:4px 10px;font-weight:700}' +
      '#' + PANEL_ID + ' .sa-bd{padding:14px 18px}' +
      '#' + PANEL_ID + ' .sa-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}' +
      '#' + PANEL_ID + ' .sa-row label{flex:0 0 110px;font-size:12px;color:#334155}' +
      '#' + PANEL_ID + ' select{flex:1 1 200px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px}' +
      '#' + PANEL_ID + ' .sa-learn{font-size:12.5px;background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:8px;padding:9px 11px;margin:6px 0}' +
      '#' + PANEL_ID + ' .sa-learn b{color:#2E6A4B}' +
      '#' + PANEL_ID + ' .sa-note{font-size:11.5px;color:#64748b;margin-top:8px}' +
      '#' + PANEL_ID + ' .sa-go{cursor:pointer;font-weight:700;border:1px solid #7A5CC0;background:#7A5CC0;color:#fff;border-radius:9px;padding:9px 16px}' +
      '#' + PANEL_ID + ' .sa-clear{cursor:pointer;font-weight:600;border:1px solid #cbd5e1;background:#FCFBF8;color:#334155;border-radius:9px;padding:8px 13px}' +
      '#' + PANEL_ID + ' .sa-ft{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px 16px;border-top:1px solid #e2e8f0}' +
      '#' + BANNER_ID + '{position:fixed;left:50%;transform:translateX(-50%);top:14px;z-index:2147483602;max-width:min(760px,94vw);padding:11px 14px;border-radius:11px;font:13px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.22)}' +
      '#' + BANNER_ID + '.watch{background:#eff6ff;border:1px solid #2E6A4B;color:#204034}' +
      '#' + BANNER_ID + '.warn{background:#fffbeb;border:1px solid #f59e0b;color:#92400e}' +
      '#' + BANNER_ID + '.ok{background:#ecfdf5;border:1px solid #2E6A4B;color:#065f46}' +
      '#' + BANNER_ID + ' button{margin-left:10px;cursor:pointer;font-weight:700;font-size:12px;border-radius:8px;border:1px solid currentColor;background:#fff;padding:4px 10px}';
    (document.head || document.documentElement).appendChild(s);
  }

  function openPanel(kind) {
    ensureStyle();
    if (kind) teachKind = kind;
    var existing = $(PANEL_ID); if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var wrap = document.createElement('div'); wrap.id = PANEL_ID; wrap.setAttribute('data-mls-showasst', '1');
    var card = document.createElement('div'); card.className = 'sa-card';

    var hd = document.createElement('div'); hd.className = 'sa-hd';
    var ht = document.createElement('div');
    var h2 = document.createElement('h2'); h2.textContent = 'Show MLS Assistant'; ht.appendChild(h2);
    var sub = document.createElement('div'); sub.className = 'sa-sub';
    sub.textContent = 'Teach the writeback location by showing it - navigate to the spot in athenaOne and click it. Watching is read-only.';
    ht.appendChild(sub); hd.appendChild(ht);
    var x = document.createElement('button'); x.type = 'button'; x.className = 'sa-x'; x.textContent = 'Close'; x.addEventListener('click', closePanel); hd.appendChild(x);
    card.appendChild(hd);

    var bd = document.createElement('div'); bd.className = 'sa-bd';

    var row = document.createElement('div'); row.className = 'sa-row';
    var lbl = document.createElement('label'); lbl.textContent = 'Teach destination for'; row.appendChild(lbl);
    var sel = document.createElement('select'); sel.id = 'mlsShowAsstKind';
    KINDS.forEach(function (k) { var o = document.createElement('option'); o.value = k.key; o.textContent = k.label; if (k.key === teachKind) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { teachKind = sel.value; refreshPanel(); });
    row.appendChild(sel);
    bd.appendChild(row);

    var learn = document.createElement('div'); learn.className = 'sa-learn'; learn.id = 'mlsShowAsstLearned';
    bd.appendChild(learn);

    var note = document.createElement('div'); note.className = 'sa-note';
    note.innerHTML =
      'When you click "Show me where", MLS asks the athenaOne page (via MLS Assist) to watch your next click, captures a robust selector + section label, and saves it as the destination through the existing writeback router. ' +
      'Observing is read-only: nothing is typed, clicked-through, written, or signed. Any later write still uses your user-initiated, name+DOB-gated writeback.';
    bd.appendChild(note);

    card.appendChild(bd);

    var ft = document.createElement('div'); ft.className = 'sa-ft';
    var clr = document.createElement('button'); clr.type = 'button'; clr.className = 'sa-clear'; clr.textContent = 'Clear / re-teach';
    clr.addEventListener('click', function () { clearLearned(teachKind); refreshPanel(); notify('Cleared the learned ' + kindLabel(teachKind) + ' destination. You can teach it again.', 'note'); });
    ft.appendChild(clr);
    var go = document.createElement('button'); go.type = 'button'; go.className = 'sa-go'; go.textContent = 'Show me where';
    go.addEventListener('click', function () { closePanel(); startTeach(teachKind); });
    ft.appendChild(go);
    card.appendChild(ft);

    wrap.appendChild(card);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closePanel(); });
    (document.body || document.documentElement).appendChild(wrap);
    refreshPanel();
  }
  function closePanel() { var m = $(PANEL_ID); if (m && m.parentNode) m.parentNode.removeChild(m); }

  function refreshPanel() {
    var box = $('mlsShowAsstLearned'); if (!box) return;
    var l = learnedFor(teachKind);
    if (!l) {
      box.innerHTML = 'No location taught for <b>' + esc(kindLabel(teachKind)) + '</b> yet. Click "Show me where", then click the spot in athenaOne.';
      return;
    }
    var viaTxt = l.via === 'extension' ? 'from athenaOne' : 'in-page (athenaOne observer pending in MLS Assist)';
    box.innerHTML = 'Learned for <b>' + esc(kindLabel(teachKind)) + '</b>: <b>' + esc(l.label || l.selector || '(target)') + '</b>' +
      (l.selector ? '<br><span style="color:#64748b">selector: <code>' + esc(l.selector.length > 90 ? l.selector.slice(0, 90) + '...' : l.selector) + '</code></span>' : '') +
      '<br><span style="color:#64748b">' + esc(viaTxt) + (l.at ? ' &middot; ' + esc(l.at.slice(0, 10)) : '') + '</span>';
  }

  /* ================================================================
   *  BUTTON INJECTION - into the item61 writeback panel + launchers
   * ================================================================ */
  function makeButton() {
    var b = document.createElement('button');
    b.type = 'button'; b.className = BTN_CLASS; b.setAttribute('data-mls-showasst', '1');
    b.textContent = 'Show MLS Assistant';
    b.title = 'Teach the writeback location by showing it in athenaOne (read-only observe)';
    b.addEventListener('click', function (ev) { ev.preventDefault(); openPanel(); });
    return b;
  }
  function injectButtons() {
    safe(function () {
      // 1) next to item61's launchers in the writeback panel area
      var hosts = [$('emrCard'), $('procNoteCard')];
      for (var i = 0; i < hosts.length; i++) {
        var h = hosts[i]; if (!h) continue;
        if (!h.querySelector('.' + BTN_CLASS)) {
          var anchor = h.querySelector('.mlswbc-launch');
          if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(makeButton(), anchor.nextSibling);
          else h.appendChild(makeButton());
        }
      }
      // 2) inside item61's open "Writeback destination" modal, as a top option
      var modal = $('mlsWbcModal');
      if (modal) {
        var bd = modal.querySelector('.wbc-bd');
        if (bd && !bd.querySelector('.mls-showasst-modalgrp')) {
          var grp = document.createElement('div');
          grp.className = 'wbc-grp mls-showasst-modalgrp'; grp.setAttribute('data-mls-showasst', '1');
          var hh = document.createElement('h3'); hh.textContent = 'Or: teach the location by showing it'; hh.style.textTransform = 'none';
          grp.appendChild(hh);
          var p = document.createElement('div'); p.style.cssText = 'font-size:12.5px;color:#475569;margin-bottom:8px';
          p.textContent = 'Instead of picking from the fields above, click "Show MLS Assistant", then go to athenaOne and click the exact section/field. MLS watches (read-only), captures it, and saves it as the destination.';
          grp.appendChild(p);
          grp.appendChild(makeButton());
          bd.insertBefore(grp, bd.firstChild);
        }
      }
    });
  }

  /* ================================================================
   *  CHAT SEAM (chain-safe wrapper of __mlsWbRouter.parseCommand)
   *  "show me where to put the note" / "teach the location" -> open panel.
   *  Returns null for anything we do not own, so it always falls through.
   * ================================================================ */
  function handleChat(text) {
    var t = trim(text); if (!t) return null;
    var low = t.toLowerCase();
    var teachVerb = /\b(show|teach|demonstrate|point|learn)\b/.test(low);
    var teachObj = /\b(where|location|destination|spot|section|field|put|place|here)\b/.test(low);
    var assistRef = /\bshow\s+mls\s+assistant\b/.test(low);
    if (assistRef || (teachVerb && teachObj && /\b(note|op[\s-]?note|injection|diagnos|dx|cpt|billing|writeback)\b/.test(low))) {
      var kind = (router() && isFn(router().canonKind)) ? safe(function () { return router().canonKind(low); }, null) : null;
      openPanel(kind || 'note');
      return { matched: true, reply: 'Opened "Show MLS Assistant". Click "Show me where", then go to athenaOne and click the exact section/field for the ' + kindLabel(kind || 'note') + '. I watch read-only, capture the target, and save it as the writeback destination. Nothing is written or signed while teaching.' };
    }
    return null;
  }

  var WRAPPED = null;
  function ensureWrap() {
    var wbr = router(); if (!wbr) return false;
    if (wbr.parseCommand === WRAPPED && wbr.__mlsShowAsstWrapped) return true;
    var prev = isFn(wbr.parseCommand) ? wbr.parseCommand.bind(wbr) : function () { return { matched: false }; };
    WRAPPED = function (text) {
      try { var r = handleChat(text); if (r && r.matched) return r; } catch (e) {}
      try { return prev(text); } catch (e2) { return { matched: false }; }
    };
    WRAPPED.__mlsShowAsst = true;
    wbr.__mlsShowAsstWrapped = true;
    wbr.__mlsShowAsstPrev = prev;
    wbr.parseCommand = WRAPPED;
    return true;
  }
  function unwrap() {
    var wbr = router(); if (!wbr) return;
    safe(function () {
      if (wbr.__mlsShowAsstWrapped && isFn(wbr.__mlsShowAsstPrev) && wbr.parseCommand === WRAPPED) {
        wbr.parseCommand = wbr.__mlsShowAsstPrev;
      }
      try { delete wbr.__mlsShowAsstWrapped; delete wbr.__mlsShowAsstPrev; } catch (e) { wbr.__mlsShowAsstWrapped = undefined; wbr.__mlsShowAsstPrev = undefined; }
    });
    WRAPPED = null;
  }

  /* ================================================================
   *  BOOT / REVERT
   * ================================================================ */
  var mo = null, retimer = null, guard = null;
  function scheduleInject() { if (retimer) return; retimer = setTimeout(function () { retimer = null; injectButtons(); }, 300); }
  function boot() {
    ensureStyle();
    injectButtons();
    ensureWrap();
    guard = setInterval(ensureWrap, 3000);
    try { mo = new MutationObserver(scheduleInject); mo.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  function revert() {
    try { if (teaching) cancelTeach(null); } catch (e) {}
    try { if (mo) mo.disconnect(); } catch (e) {} mo = null;
    if (retimer) { clearTimeout(retimer); retimer = null; }
    if (guard) { clearInterval(guard); guard = null; }
    try { unwrap(); } catch (e) {}
    teardownListeners();
    safe(function () { closePanel(); });
    safe(function () { hideBanner(); });
    safe(function () { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { [].slice.call(document.querySelectorAll('.' + BTN_CLASS + ',.mls-showasst-modalgrp,[data-mls-showasst]')).forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); }); });
    try { window.__mlsShowAsst.installed = false; } catch (e) {}
  }

  /* ================================================================
   *  PUBLIC API
   * ================================================================ */
  window.__mlsShowAsst = {
    installed: true, version: VERSION, asset: ASSET,
    open: openPanel, close: closePanel,
    start: startTeach,                 /* read-only observe; user-initiated */
    cancel: function () { cancelTeach('Teaching cancelled.'); },
    clear: clearLearned,
    learned: learnedFor,
    _handle: handleChat,               /* exposed for diagnostics (no write) */
    injectButtons: injectButtons,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
