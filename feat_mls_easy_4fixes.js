/* feat_mls_easy_4fixes.js  ->  window.__mlsEasy4Fixes  (v1.0.0)
 *
 * Four additive, independently-reversible fixes to the SIMPLE "MLS Easy" flow.
 * Composes with -- never edits -- the deployed modules:
 *   - feat_mls_easy.js          (S57, window.__mlsEasy)        the slide step machine
 *   - feat_mls_protocol.js      (S70, window.__mlsProtocol)    slide-2 picker + #mlsProtoScratch
 *   - feat_mls_easy_pickfix.js  (S71/S75, __mlsEasyPickFix)    the picker + big Go-to-recording
 *   - feat_mls_easy_hardening.js(S?,  __mlsEasyHarden)         anti-glitch guards
 *   - mls-opnote-pro.js         (S53, __mlsOpNotePro/Pdf)      the op-note builder + PDF
 *
 * THE FOUR FIXES
 *   (1) RECORDED TEXT -> SLIDE-2 TEXTBOX. The recorder writes recognized speech into
 *       #transcript SILENTLY (recog.onresult sets transcript.value with no 'input'
 *       event), so the visible record textbox (#mlsProtoScratch) never shows the
 *       dictation. We make #mlsProtoScratch a live, editable mirror of #transcript:
 *       dictation appears in the box, and text the doctor types in the box is pushed
 *       back into #transcript AND into the recognizer baseline (window.finalText) so
 *       the next recognizer write cannot clobber it. Generate keeps reading #transcript.
 *   (2) BACK BUTTON RELIABILITY. The "<- Back" control loses its own click listener on
 *       re-render/re-injection (the audited churn class), so clicks intermittently do
 *       nothing. We add ONE document-level capture-phase handler that recognizes any
 *       MLS-Easy Back control and performs the correct navigation every time
 *       (exit the slide-2 picker overlay if active, else __mlsEasy.goto(step-1)).
 *   (3) MANUAL ENTRY -> ACTIVE PATIENT + BANNER + GENERATION. heroStartVisit() (manual
 *       name+DOB) only links an EXISTING exact-name patient; a newly-typed patient is
 *       never made active, so the top banner (renderPatientBar/renderProfile) and
 *       generation (activePatient()) miss them. We wrap heroStartVisit() to create
 *       (via the app's own upsertPatient) and ACTIVATE (via the app's own
 *       selectPatient) the typed patient, which updates the banner and points
 *       generation at them.
 *   (4) PREP-OP-NOTE ON SIMPLE SLIDE 2. The op-note builder (generateProcNote ->
 *       #procResultWrap, enhanced by mls-opnote-pro) lives only on the full/complex
 *       view. We add a "Prep op note" control to the record step and REUSE the
 *       existing builder (no rebuild): it runs generateProcNote for the active patient
 *       and surfaces the real #procResultWrap (with its existing Save-as-PDF) inline.
 *
 * SAFETY: own IIFE; every external call wrapped in try/catch; sends NOTHING to the
 * MLS Assist extension; never clicks Save/Sign/attest and never writes a chart (Fix 4
 * only routes to the EXISTING, separately-guarded op-note builder, which does not sign
 * or write to Athena). Patient creation in Fix 3 uses the app's own upsertPatient --
 * the same call the manual "New patient" modal and the schedule import already use --
 * it is ordinary local patient-list management, not a chart write. Idempotent injections,
 * marker-guarded, with a slow poll + rAF-debounced observer so it cannot drive an idle
 * re-render loop. window.__mlsEasy4Fixes.revert() removes every listener/timer/wrap and
 * restores any relocated node. NUL-free. No PHI in any log.
 */
(function () {
  'use strict';
  try { if (window.__mlsEasy4Fixes && window.__mlsEasy4Fixes.installed) return; } catch (e) { return; }

  var VERSION = '1.0.0';
  var ASSET = 'feat_mls_easy_4fixes.js';

  /* ---------------- tiny safe helpers ---------------- */
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function q(sel, root) { return safe(function () { return (root || document).querySelector(sel); }, null); }
  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
  function now() { return Date.now(); }
  function txtval(el) { return (el && typeof el.value === 'string') ? el.value : ''; }

  /* ---------------- shared MLS Easy contracts (all feature-detected) ---------------- */
  function easy() { return safe(function () { return window.__mlsEasy; }, null) || null; }
  function easyState() { var e = easy(); return (e && e.state) ? e.state : null; }
  function curStep() { var s = easyState(); return s && s.step ? s.step : 0; }
  function inEasy() { var s = easyState(); return !!(s && s.mode !== 'full'); }
  function protocol() { return safe(function () { return window.__mlsProtocol; }, null) || null; }
  function slide2Active() { var p = protocol(); return !!(p && p._s2 && p._s2.active); }

  function scratchBox() { return gid('mlsProtoScratch'); }
  function transcriptEl() { return gid('transcript'); }

  /* ============================================================
   *  FIX 1 -- recorded transcript -> #mlsProtoScratch (live mirror)
   * ============================================================
   * Model: #transcript is the single source of truth Generate consumes.
   * #mlsProtoScratch becomes a faithful, editable mirror of it.
   *   - transcript changed (recognizer, silent) -> copy into the box (unless the box
   *     is focused, so we never yank the caret while the doctor types).
   *   - box edited by the doctor -> copy into #transcript (dispatch 'input' so other
   *     consumers update) AND, while recording, update window.finalText so the next
   *     recognizer write appends after the typed text instead of overwriting it.
   * We OWN the textarea by cloning it once (which drops S70's own 'input' handler and
   * its [Typed notes]-block model, replacing it with this simpler merge). If S70 ever
   * rebuilds the box, ensureFix1() re-acquires it.
   */
  var F1 = { lastT: null, poll: null, ownedBox: null };

  function fx1Capturing() {
    return safe(function () { return !!window.capturing; }, false);
  }

  function fx1PushBoxToTranscript() {
    var box = F1.ownedBox; var tr = transcriptEl();
    if (!box || !tr) return;
    var v = txtval(box);
    /* FIX 2026-07-01: MERGE dictation that landed in #transcript while the doctor was typing
       in the box (the old code overwrote it -- spoken words were silently LOST). F1.lastT is
       the last transcript text the box has seen; anything beyond it is the new spoken tail. */
    var cur = txtval(tr);
    if (F1.lastT != null && cur !== F1.lastT && cur.indexOf(F1.lastT) === 0) {
      var tail = cur.slice(F1.lastT.length).replace(/^\s+/, '');
      if (tail && v.indexOf(tail) === -1) { v = v.replace(/\s*$/, '') + ' ' + tail; safe(function () { box.value = v; }); }
    }
    if (txtval(tr) !== v) {
      tr.value = v;
      safe(function () { tr.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    /* keep recognizer baseline in sync so dictation never clobbers typed text */
    if (fx1Capturing()) { safe(function () { window.finalText = v ? (v.replace(/\s*$/, '') + ' ') : ''; }); }
    /* keep S70 persistence value consistent for compatibility */
    safe(function () { window.__mlsProtoScratchText = v; });
    F1.lastT = txtval(tr);
  }

  function fx1MirrorTranscriptToBox() {
    var box = F1.ownedBox; var tr = transcriptEl();
    if (!box || !tr) return;
    var tv = txtval(tr);
    if (tv === F1.lastT) return;            /* nothing new */
    /* FIX 2026-07-01: focus check must run BEFORE lastT advances -- otherwise dictation that
       arrives while the doctor types is "consumed" without ever reaching the box, and the
       next push overwrites it in #transcript. Leaving lastT put lets the push MERGE the tail. */
    if (document.activeElement === box) return; /* don't fight the typing caret */
    F1.lastT = tv;
    if (txtval(box) !== tv) box.value = tv;
    safe(function () { window.__mlsProtoScratchText = txtval(box); });
  }

  function fx1OnBoxInput() {
    /* user typed/edited the box */
    fx1PushBoxToTranscript();
  }

  function fx1AcquireBox() {
    var box = scratchBox();
    if (!box) { F1.ownedBox = null; return; }
    if (box.getAttribute('data-mls4fx-mirror') === '1' && F1.ownedBox === box) return;
    /* clone to strip any pre-existing listeners (e.g. S70 syncScratch), keep value/attrs */
    var fresh = box.cloneNode(true);
    fresh.setAttribute('data-mls4fx-mirror', '1');
    if (box.parentNode) box.parentNode.replaceChild(fresh, box);
    F1.ownedBox = fresh;
    /* seed the box from the current transcript so any existing dictation/text shows */
    var tr = transcriptEl();
    var seed = tr ? txtval(tr) : (safe(function () { return window.__mlsProtoScratchText; }, '') || '');
    if (seed && txtval(fresh) !== seed) fresh.value = seed;
    F1.lastT = tr ? txtval(tr) : seed;
    fresh.addEventListener('input', fx1OnBoxInput);
    /* if the box already had text and transcript is empty, push it through */
    if (txtval(fresh) && tr && !txtval(tr)) fx1PushBoxToTranscript();
  }

  function fx1Tick() {
    if (!(inEasy() && curStep() === 2)) return;
    fx1AcquireBox();
    fx1MirrorTranscriptToBox();
  }

  function fx1Start() {
    if (F1.poll) return;
    /* a modest poll catches the recognizer's SILENT writes to #transcript */
    F1.poll = setInterval(function () { safe(fx1Tick); }, 300);
  }
  function fx1Stop() { if (F1.poll) { clearInterval(F1.poll); F1.poll = null; } }

  /* ============================================================
   *  FIX 2 -- reliable "<- Back"
   * ============================================================
   * One document-level CAPTURE handler so it works even when the button's own
   * listener was lost on a re-render. Recognizes the Back control by id/class, or by
   * "Back" text inside the MLS Easy region. Navigation: exit slide-2 overlay if active,
   * else __mlsEasy.goto(step-1). Debounced so it can't double-fire.
   */
  var F2 = { lastNav: 0, bound: false };

  function fx2WithinEasy(el) {
    if (!el || !el.closest) return false;
    return !!(el.closest('#mlsEasyPanel, #mlsProtoSlide2, .mlsproto-s2foot, [data-mls-easy], .ez-panel, .ez-body'));
  }

  function fx2IsBackControl(el) {
    if (!el || !el.closest) return null;
    var direct = el.closest('#mlsProtoBack, .mlsproto-back, [data-mls-back]');
    if (direct) return direct;
    /* text-based fallback, scoped to the MLS Easy region and to button-like nodes */
    var btn = el.closest('button, a, [role="button"]');
    if (!btn || !fx2WithinEasy(btn)) return null;
    var t = (btn.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^[\s←<«]*back\b/i.test(t) && t.length <= 16) return btn;
    return null;
  }

  function fx2GoBack() {
    var t = now();
    if (t - F2.lastNav < 350) return true; /* debounce double handlers */
    F2.lastNav = t;
    /* 1) slide-2 picker overlay open? close it (returns to step-1 content) */
    if (slide2Active()) {
      var p = protocol();
      if (p && isFn(p.exitSlide2)) { safe(function () { p.exitSlide2(); }); return true; }
      var panel = q('.mlsproto-s2'); if (panel) { safe(function () { panel.classList.remove('mlsproto-s2'); }); return true; }
    }
    /* 2) step machine: go to previous step */
    var e = easy(); var step = curStep();
    if (e && isFn(e.goto) && step > 1) { safe(function () { e.goto(step - 1); }); return true; }
    if (e && isFn(e.back) && step > 1) { safe(function () { e.back(); }); return true; }
    return false;
  }

  function fx2OnClick(ev) {
    var target = ev && ev.target ? ev.target : null;
    var ctl = fx2IsBackControl(target);
    if (!ctl) return;
    if (!inEasy()) return;
    /* perform the navigation reliably; do not block the element's own handler
       (idempotent: both compute the same previous step) */
    fx2GoBack();
  }

  function fx2Install() {
    if (F2.bound) return;
    safe(function () { document.addEventListener('click', fx2OnClick, true); });
    F2.bound = true;
  }
  function fx2Remove() {
    if (!F2.bound) return;
    safe(function () { document.removeEventListener('click', fx2OnClick, true); });
    F2.bound = false;
  }

  /* ============================================================
   *  FIX 3 -- manual name+DOB -> active patient + banner + generation
   * ============================================================
   * Wrap window.heroStartVisit so that after its original work, the typed patient is
   * created (if new) via the app's own upsertPatient and ACTIVATED via the app's own
   * selectPatient (which already does setActivePtId + renderProfile + renderPatientBar
   * + updateNavCounts). Generation reads activePatient(), so it then targets them.
   */
  var F3 = { orig: null, wrapped: false };

  function fx3NewId() {
    return 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
  }

  function fx3Activate() {
    var name = (txtval(gid('heroPtName')) || '').trim();
    var dob = (txtval(gid('heroPtDob')) || '').trim();
    if (!name) return;
    var getPts = window.getPatients, sel = window.selectPatient, ups = window.upsertPatient;
    var existing = null;
    if (isFn(getPts)) {
      existing = safe(function () {
        return (getPts() || []).filter(function (x) {
          return String(x && x.name || '').trim().toLowerCase() === name.toLowerCase();
        })[0] || null;
      }, null);
    }
    if (existing && existing.id) {
      if (isFn(sel)) { safe(function () { sel(existing.id); }); }
      else fx3FallbackActivate(existing.id);
      return;
    }
    /* create the patient using the app's own model + id convention */
    if (isFn(ups)) {
      var p = { id: fx3NewId(), name: name, dob: dob, problems: '', meds: '', allergies: '', summary: '', docs: [], source: 'manual', created: Date.now() };
      var ok = safe(function () { ups(p); return true; }, false);
      if (ok) {
        if (isFn(sel)) { safe(function () { sel(p.id); }); }
        else fx3FallbackActivate(p.id);
        return;
      }
    }
    /* last resort: at least set DOB into context so the existing path carries it (orig already did) */
  }

  function fx3FallbackActivate(id) {
    if (isFn(window.setActivePtId)) safe(function () { window.setActivePtId(id); });
    if (isFn(window.renderProfile)) safe(function () { window.renderProfile(); });
    if (isFn(window.renderPatientBar)) safe(function () { window.renderPatientBar(); });
    if (isFn(window.updateNavCounts)) safe(function () { window.updateNavCounts(); });
  }

  function fx3Wrap() {
    if (F3.wrapped) return;
    if (!isFn(window.heroStartVisit)) return;            /* try again later */
    if (window.heroStartVisit.__mls4fxWrapped) { F3.wrapped = true; return; }
    F3.orig = window.heroStartVisit;
    var wrapped = function () {
      var r;
      try { r = F3.orig.apply(this, arguments); } catch (e) { r = undefined; }
      safe(fx3Activate);
      return r;
    };
    wrapped.__mls4fxWrapped = true;
    safe(function () { window.heroStartVisit = wrapped; });
    F3.wrapped = true;
  }
  function fx3Unwrap() {
    if (!F3.wrapped || !F3.orig) return;
    safe(function () { if (window.heroStartVisit && window.heroStartVisit.__mls4fxWrapped) window.heroStartVisit = F3.orig; });
    F3.wrapped = false;
  }

  /* ============================================================
   *  FIX 4 -- prep-op-note on the simple-view record step (slide 2)
   * ============================================================
   * Inject a small control on step 2 and REUSE the existing builder:
   *   - runs window.generateProcNote (enhanced by mls-opnote-pro) for the active patient
   *   - surfaces the real #procResultWrap inline (with its existing Save-as-PDF button)
   * Nothing is rebuilt. If the builder is absent on this view, show an honest notice.
   */
  var F4 = { movedNode: null, movedParent: null, movedNext: null };

  function fx4Notice(host, msg) {
    if (!host) return;
    var n = host.querySelector('.mls4fx-op-note');
    if (!n) { n = ce('div', 'mls4fx-op-note'); n.style.cssText = 'margin:8px 1px 0;font-size:12.5px;color:#EAF1EC;opacity:.95;line-height:1.4;'; host.appendChild(n); }
    n.textContent = msg;
  }

  function fx4Run() {
    var host = gid('mls4fxOpHost'); if (!host) return;
    if (!isFn(window.activePatient) || !safe(function () { return window.activePatient(); }, null)) {
      fx4Notice(host, 'Pick or enter a patient first — the op note attaches to the active patient.');
    }
    if (!isFn(window.generateProcNote)) { fx4Notice(host, 'Prep-op-note builder is not available on this view.'); return; }
    var procIn = gid('mls4fxProc');
    var proc = procIn ? (txtval(procIn) || '').trim() : '';
    safe(function () { proc ? window.generateProcNote({ proc: proc }) : window.generateProcNote(); });
    /* surface the real result panel inline */
    var wrap = gid('procResultWrap');
    if (!wrap) { fx4Notice(host, 'Generated — open the full view to see the op note (no inline panel on this build).'); return; }
    if (wrap.parentNode !== host) {
      if (!F4.movedNode) { F4.movedNode = wrap; F4.movedParent = wrap.parentNode; F4.movedNext = wrap.nextSibling; }
      safe(function () { host.appendChild(wrap); });
    }
    safe(function () { wrap.style.display = 'block'; });
    var nt = host.querySelector('.mls4fx-op-note'); if (nt) nt.textContent = '';
  }

  function fx4RestoreNode() {
    if (F4.movedNode && F4.movedParent) {
      safe(function () {
        if (F4.movedNext && F4.movedNext.parentNode === F4.movedParent) F4.movedParent.insertBefore(F4.movedNode, F4.movedNext);
        else F4.movedParent.appendChild(F4.movedNode);
      });
    }
    F4.movedNode = F4.movedParent = F4.movedNext = null;
  }

  function fx4Inject() {
    if (!(inEasy() && curStep() === 2)) return;
    if (gid('mls4fxOpWrap')) return;                 /* idempotent */
    var box = scratchBox(); if (!box) return;        /* anchor to the record textbox */
    var anchor = gid('mlsProtoScratchWrap') || box;
    var wrap = ce('div'); wrap.id = 'mls4fxOpWrap';
    wrap.style.cssText = 'margin:10px 0 2px;';
    wrap.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<input id="mls4fxProc" type="text" placeholder="Procedure (optional)" ' +
          'style="flex:1;min-width:140px;box-sizing:border-box;padding:9px 11px;border-radius:10px;border:2px solid rgba(255,255,255,.55);background:#fff;color:#13243a;font:13.5px/1.4 inherit;">' +
        '<button type="button" id="mls4fxPrepOp" ' +
          'style="white-space:nowrap;padding:10px 14px;border:0;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;color:#fff;background:#0a7d2c;box-shadow:0 2px 8px rgba(8,20,36,.18);">' +
          '🧾 Prep op note</button>' +
      '</div>' +
      '<div id="mls4fxOpHost" style="margin-top:10px;"></div>';
    if (anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    else { var b = q('.ez-body') || document.body; b.appendChild(wrap); }
    var btn = gid('mls4fxPrepOp');
    if (btn && !btn.__mls4fxBound) { btn.__mls4fxBound = true; btn.addEventListener('click', function (ev) { safe(function () { ev.preventDefault(); }); safe(fx4Run); }); }
  }

  function fx4Remove() {
    fx4RestoreNode();
    var w = gid('mls4fxOpWrap'); if (w && w.parentNode) w.parentNode.removeChild(w);
  }

  /* ============================================================
   *  ensure() -- idempotent UI upkeep, tamed (no idle re-render loop)
   * ============================================================ */
  var _obs = null, _poll = null, _raf = 0, _reverted = false;

  function ensure() {
    if (_reverted) return;
    safe(fx3Wrap);                       /* one-time once heroStartVisit exists */
    if (inEasy() && curStep() === 2) {
      fx1Start();
      safe(fx1Tick);
      safe(fx4Inject);
    } else {
      /* leaving the record step: stop the Fix-1 poll and restore Fix-4 node */
      fx1Stop();
      if (gid('mls4fxOpWrap') || F4.movedNode) safe(fx4Remove);
    }
  }

  function schedule() {
    if (_raf || _reverted) return;
    _raf = safe(function () {
      return requestAnimationFrame(function () { _raf = 0; if (!_reverted) safe(ensure); });
    }, 0) || 0;
    if (!_raf) { safe(function () { setTimeout(function () { if (!_reverted) safe(ensure); }, 16); }); }
  }

  function startWatch() {
    safe(function () {
      _obs = new MutationObserver(function () { if (!_reverted) schedule(); });
      _obs.observe(document.body, { childList: true, subtree: true });
    });
    _poll = setInterval(function () { if (!_reverted) safe(ensure); }, 900);
  }

  /* ---------------- revert ---------------- */
  function revert() {
    _reverted = true;
    safe(function () { if (_obs) _obs.disconnect(); }); _obs = null;
    safe(function () { if (_poll) clearInterval(_poll); }); _poll = null;
    fx1Stop();
    fx2Remove();
    fx3Unwrap();
    safe(fx4Remove);
    safe(function () { window.__mlsEasy4Fixes.installed = false; });
    return true;
  }

  /* ---------------- boot ---------------- */
  function boot() {
    fx2Install();      /* Fix 2 is global + cheap; always on */
    safe(fx3Wrap);     /* Fix 3 wrap as soon as heroStartVisit exists */
    startWatch();      /* Fixes 1 & 4 mount on the record step */
    safe(ensure);
  }

  window.__mlsEasy4Fixes = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    revert: revert,
    /* diagnostics / test hooks (no PHI; structural only) */
    _ensure: function () { safe(ensure); },
    _fx1Tick: function () { safe(fx1Tick); },
    _fx2GoBack: function () { return safe(fx2GoBack, false); },
    _fx3Activate: function () { safe(fx3Activate); },
    _fx4Run: function () { safe(fx4Run); },
    _fx4Inject: function () { safe(fx4Inject); }
  };

  // Fix 2 is a document-level handler that needs only document (not DOM-ready), so
  // install it immediately: Back works from the first paint. boot() re-calls it (idempotent).
  safe(fx2Install);

  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
  catch (e) { safe(boot); }
})();
