/* ============================================================================
 * feat_mls_turn_labels.js  ->  window.__mlsTurns   (tn-1.0.0)
 * ---------------------------------------------------------------------------
 * WHO SAID WHAT — as a HYPOTHESIS the doctor corrects, never as a fact.
 *
 * Owner, 2026-07-26: "adding who said what in the textbox".
 *
 * THE HONEST STARTING POINT
 * -------------------------
 * The browser Web Speech API HAS NO DIARIZATION. It does not tell you how many
 * people are in the room, when one stops and another starts, or which is which.
 * There is no confidence score for speaker, because there is no speaker field.
 * Anything that prints "Dr:" next to a line of a browser transcript is guessing.
 *
 * So this module does not pretend. What it actually has is a real signal, and
 * only one: WHERE THE PAUSES WERE. A recognizer emits final results, and the
 * wall-clock gap between them is a genuine measurement of silence. Conversation
 * turns usually change across a long pause. Usually. Not always — a doctor who
 * pauses mid-sentence to read a chart gets split, and a patient who interrupts
 * without a gap does not.
 *
 * That is the whole basis, stated plainly, and everything below follows from it:
 *
 *   - Turns are PAUSE boundaries. The public API calls them turns because that
 *     is what a doctor calls them, but every record carries `basis:'pause'` and
 *     the gap in milliseconds that produced it, so no caller can mistake it for
 *     voice identification.
 *   - Labels alternate from a starting label as a SUGGESTION. Every suggested
 *     label is marked `assumed:true`. The moment the doctor taps one it becomes
 *     `assumed:false`, and alternation re-anchors from that corrected turn —
 *     one correction fixes everything after it.
 *   - The applied transcript carries ONE header line saying the labels are a
 *     guess. Not a decoration: it is what makes the labels honest inside the
 *     note-generation prompt, which is amended to match.
 *   - THE RAW TRANSCRIPT IS ALWAYS RECOVERABLE. raw() returns the exact
 *     unlabelled text, byte for byte, and unapply() puts it back. Labelling is
 *     never destructive, and the un-labelled text is what is kept in memory —
 *     the labelled form is DERIVED on demand, so it cannot rot.
 *
 * WHY LABELS ARE APPLIED ONLY WHEN THE RECORDER IS NOT WRITING
 * ------------------------------------------------------------
 * During capture, ScribeFlow.html's own handler owns #transcript absolutely:
 *     document.getElementById('transcript').value = (finalText + interim).trim()
 * `finalText` is a top-level `let`. A top-level `let` IS NOT A WINDOW PROPERTY,
 * so nothing outside that script can read or amend it — any label written into
 * the box mid-capture is destroyed by the very next recognition result, and
 * would look to a doctor like the app eating their transcript.
 *
 * So during capture the turns are shown in the strip, live, and the box is left
 * to its owner. On stop, apply() rewrites #transcript once. If recording then
 * resumes, startCapture() re-seeds finalText from the box, so the labels survive
 * as a prefix and new speech appends after them.
 *
 * WHAT IT OWNS AND DOES NOT
 * -------------------------
 *   - It owns NO recognizer and NO microphone lease. It attaches an ADDITIVE
 *     'result' listener via a SpeechRecognition.prototype.start wrap — the same
 *     proven mechanism feat_mls_voice_ai_micbridge.js already uses — and gates
 *     it to the VISIT dictation recognizer (the mirror image of that module's
 *     gate, so the two never see the same stream).
 *   - It writes #transcript CONTENT. It does not touch visit-lane layout: the
 *     one row it mounts is its own element, class-hidden when there is nothing
 *     to show, inline, never floating, and removed by revert().
 *   - It never sends, signs, saves or generates anything.
 *
 * Additive, idempotent, reversible: window.__mlsTurns.revert().
 * ==========================================================================*/
(function () {
  'use strict';

  var VERSION = 'tn-1.0.0';
  var ASSET = 'feat_mls_turn_labels.js';
  try {
    if (window.__mlsTurns && window.__mlsTurns.installed && window.__mlsTurns.version === VERSION) return;
  } catch (e0) { return; }

  /* A gap this long between two final results is treated as a turn boundary.
     1200ms is a deliberate compromise measured against ordinary clinical speech:
     shorter and every mid-sentence hesitation splits a turn, longer and a brisk
     question-and-answer exchange merges into one. It is exposed so it can be
     tuned from evidence rather than argued about. */
  var TURN_GAP_MS = 1200;
  var HEADER = '[Speaker labels are a guess from pauses in the recording, not voice recognition. Correct any that are wrong.]';
  var ROW_ID = 'mlsTurnStrip';
  var STYLE_ID = 'mlsTurnStyle';
  var DEFAULT_LABELS = ['Dr', 'Patient'];

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function esc(s) { return S(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* ===================== state ===================== */
  /* turns: [{ text, at, gapMs, basis:'pause', label, assumed }] */
  var turns = [];
  var labels = DEFAULT_LABELS.slice();
  var lastFinalAt = 0;
  var applied = false;
  var appliedFrom = '';     /* the exact raw text apply() was computed from */

  function appCapturing() {
    var b = $('captureBtn');
    return !!(b && /(^|\s)recording(\s|$)/.test(b.className || ''));
  }

  /* ===================== the engine ===================== */
  /* Record one FINAL recognition fragment. The gap is measured from the previous
     final's arrival — the only timing signal the API gives us. */
  function record(text, at) {
    text = S(text).trim();
    if (!text) return null;
    at = Number(at) || Date.now();
    var gap = lastFinalAt ? (at - lastFinalAt) : 0;
    lastFinalAt = at;
    var last = turns[turns.length - 1];
    if (last && gap < TURN_GAP_MS) {
      /* same turn: the speaker paused for breath, not for an answer */
      last.text = (last.text + ' ' + text).replace(/\s+/g, ' ').trim();
      last.at = at;
      paint();
      return last;
    }
    var t = {
      text: text, at: at, gapMs: gap, basis: 'pause',
      label: suggestLabel(),
      assumed: true
    };
    turns.push(t);
    paint();
    return t;
  }

  /* The suggestion, and the reason it is only a suggestion: it alternates from
     the most recent turn the DOCTOR corrected. With no correction yet it
     alternates from labels[0]. It has never heard a voice. */
  function suggestLabel() {
    for (var i = turns.length - 1; i >= 0; i--) {
      if (!turns[i].assumed) {
        var anchorIdx = labels.indexOf(turns[i].label);
        if (anchorIdx < 0) anchorIdx = 0;
        var steps = (turns.length - i) % labels.length;
        return labels[(anchorIdx + steps) % labels.length];
      }
    }
    return labels[turns.length % labels.length];
  }

  /* One tap. The corrected turn stops being assumed, and every later suggestion
     re-derives from it. */
  function setLabel(i, label) {
    i = Number(i);
    if (!turns[i]) return false;
    label = S(label).trim();
    if (!label) return false;
    if (labels.indexOf(label) < 0) labels.push(label);
    turns[i].label = label;
    turns[i].assumed = false;
    /* re-suggest everything after it that the doctor has not fixed themselves */
    for (var j = i + 1; j < turns.length; j++) {
      if (!turns[j].assumed) break;
      var anchorIdx = labels.indexOf(turns[i].label); if (anchorIdx < 0) anchorIdx = 0;
      turns[j].label = labels[(anchorIdx + ((j - i) % labels.length)) % labels.length];
    }
    paint();
    if (applied) apply();          /* keep the box agreeing with the strip */
    return true;
  }

  function cycleLabel(i) {
    if (!turns[i]) return false;
    var at = labels.indexOf(turns[i].label);
    return setLabel(i, labels[(at + 1) % labels.length]);
  }

  /* ===================== text ===================== */
  /* The exact unlabelled transcript these turns were built from. */
  function raw() {
    return turns.map(function (t) { return t.text; }).join(' ').replace(/\s+/g, ' ').trim();
  }
  /* The labelled form. DERIVED, never stored — so a label change cannot leave a
     stale copy behind, and raw() can never drift from what was heard. */
  function render() {
    if (!turns.length) return '';
    return HEADER + '\n' + turns.map(function (t) { return t.label + ': ' + t.text; }).join('\n');
  }

  function transcriptEl() { return $('transcript'); }

  /* Write the labelled form into the real transcript box.
     Refuses while the recorder is writing: ScribeFlow.html's onresult assigns
     `(finalText + interim).trim()` over the whole value, and finalText is a
     top-level `let` that nothing here can amend, so the write would be erased
     within one result and look like data loss. */
  function apply() {
    var el = transcriptEl();
    if (!el) return { ok: false, reason: 'no transcript box on this screen' };
    if (!turns.length) return { ok: false, reason: 'nothing has been recorded yet' };
    if (appCapturing()) return { ok: false, reason: 'still recording — labels go in when you stop' };
    appliedFrom = raw();
    el.value = render();
    fire(el);
    applied = true;
    paint();
    return { ok: true, turns: turns.length };
  }

  /* Put the exact unlabelled text back. */
  function unapply() {
    var el = transcriptEl();
    if (!el) return { ok: false, reason: 'no transcript box on this screen' };
    if (appCapturing()) return { ok: false, reason: 'still recording' };
    el.value = raw();
    fire(el);
    applied = false;
    paint();
    return { ok: true };
  }

  function fire(el) {
    safe(function () { el.dispatchEvent(new Event('input', { bubbles: true })); });
    safe(function () { if (isFn(window._markVisitDirty)) window._markVisitDirty(); });
  }

  /* Has the doctor edited the box since apply()? If so the labelled text is
     THEIRS now and this module must not overwrite it. */
  function boxMatchesRender() {
    var el = transcriptEl();
    return !!(el && applied && S(el.value) === render());
  }

  function reset() {
    turns = []; lastFinalAt = 0; applied = false; appliedFrom = '';
    paint();
  }

  /* ===================== the strip (inline, class-hidden, one row) ========== */
  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '#' + ROW_ID + '{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 6px;font:600 12.5px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
      '#' + ROW_ID + '.mls-turns-empty{display:none}',
      '#' + ROW_ID + ' .mtn-lbl{color:var(--muted,#636E66);font-weight:700;margin-right:2px}',
      '#' + ROW_ID + ' .mtn-turn{display:inline-flex;align-items:center;gap:6px;max-width:100%;border:1px solid var(--line,#e8edf4);background:var(--soft,#f6f9fc);color:var(--ink,#1E2B24);border-radius:999px;padding:5px 11px;cursor:pointer}',
      '#' + ROW_ID + ' .mtn-turn:hover{border-color:var(--brand,#2E6A4B)}',
      '#' + ROW_ID + ' .mtn-turn.mtn-assumed{border-style:dashed}',
      '#' + ROW_ID + ' .mtn-who{font-weight:800}',
      '#' + ROW_ID + ' .mtn-txt{font-weight:400;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}',
      '#' + ROW_ID + ' .mtn-act{border:1px solid var(--line,#e8edf4);background:var(--card,#fff);color:var(--ink,#1E2B24);border-radius:10px;padding:5px 11px;font-weight:700;cursor:pointer}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function ensureRow() {
    var row = $(ROW_ID);
    if (row && row.isConnected) return row;
    var tx = transcriptEl();
    if (!tx || !tx.parentNode) return null;
    css();
    row = document.createElement('div');
    row.id = ROW_ID;
    row.className = 'mls-turns-empty';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Speaker labels for this recording');
    tx.parentNode.insertBefore(row, tx.nextSibling);
    row.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-mtn]') : null;
      if (!t) return;
      ev.preventDefault();
      var kind = t.getAttribute('data-mtn');
      if (kind === 'apply') { var r = apply(); if (!r.ok) toast(r.reason); return; }
      if (kind === 'unapply') { var u = unapply(); if (!u.ok) toast(u.reason); return; }
      var idx = Number(t.getAttribute('data-i'));
      if (idx >= 0) cycleLabel(idx);
    });
    return row;
  }

  function toast(m) { safe(function () { if (isFn(window.toast)) window.toast(S(m), ''); }); }

  var painted = '';
  function paint() {
    var row = ensureRow();
    if (!row) return;
    if (!turns.length) {
      if (row.className !== 'mls-turns-empty') row.className = 'mls-turns-empty';
      if (row.innerHTML !== '') row.innerHTML = '';
      painted = '';
      return;
    }
    /* Repaint only on a real change. An unconditional innerHTML rewrite on a
       surface next to a live recording is how this file would become the next
       byte-identical churner in the timer audit. */
    var sig = turns.map(function (t) { return t.label + '|' + (t.assumed ? 'a' : 'c') + '|' + t.text.length; }).join(';') + '#' + (applied ? '1' : '0');
    if (sig === painted) return;
    painted = sig;
    row.className = '';
    var html = '<span class="mtn-lbl">Who said what — tap to correct:</span>';
    html += turns.map(function (t, i) {
      return '<button type="button" class="mtn-turn' + (t.assumed ? ' mtn-assumed' : '') + '" data-mtn="turn" data-i="' + i + '"' +
        ' title="' + esc(t.label + (t.assumed ? ' (guessed from a pause — tap to change)' : ' (you set this)')) + '">' +
        '<span class="mtn-who">' + esc(t.label) + '</span><span class="mtn-txt">' + esc(t.text.slice(0, 60)) + '</span></button>';
    }).join('');
    html += applied
      ? '<button type="button" class="mtn-act" data-mtn="unapply">Remove labels</button>'
      : '<button type="button" class="mtn-act" data-mtn="apply">Add labels to transcript</button>';
    row.innerHTML = html;
  }

  /* ===================== the tap on the visit recognizer ===================== */
  /* Additive listener attached through a prototype.start wrap. Gated to the
     VISIT recorder — the exact inverse of feat_mls_voice_ai_micbridge.js's gate,
     so the command recognizers and this one never see each other's audio. */
  var wrapped = [];
  function onResultTap(e) {
    safe(function () {
      if (!window.__mlsTurns || !window.__mlsTurns.installed) return;
      if (!window.__mlsTurns._testForce && !appCapturing()) return;
      if (!e || !e.results) return;
      for (var i = (e.resultIndex || 0); i < e.results.length; i++) {
        var r = e.results[i];
        if (r && r.isFinal) record((r[0] && r[0].transcript) || '', Date.now());
      }
    });
  }
  function wrapStart() {
    var ctors = [];
    safe(function () { if (window.SpeechRecognition) ctors.push(window.SpeechRecognition); });
    safe(function () { if (window.webkitSpeechRecognition && ctors.indexOf(window.webkitSpeechRecognition) === -1) ctors.push(window.webkitSpeechRecognition); });
    ctors.forEach(function (C) {
      safe(function () {
        var proto = C && C.prototype;
        if (!proto || proto.__mlsTurnsStartWrapped) return;
        var orig = proto.start;
        if (!isFn(orig)) return;
        proto.start = function () {
          safe(function () {
            if (!this.__mlsTurnsTapped) { this.__mlsTurnsTapped = true; this.addEventListener('result', onResultTap, false); }
          }.bind(this));
          return orig.apply(this, arguments);
        };
        proto.__mlsTurnsStartWrapped = true;
        wrapped.push({ proto: proto, orig: orig });
      });
    });
  }

  /* When recording stops, offer the labels. Offer — never write behind the
     doctor's back; the box is theirs and a silent rewrite of a clinical
     transcript is not a feature. */
  var stopWatch = null;
  function watchStop() {
    var b = $('captureBtn');
    if (!b || b.__mlsTurnsWatched) return;
    b.__mlsTurnsWatched = true;
    stopWatch = new MutationObserver(function () { paint(); });
    safe(function () { stopWatch.observe(b, { attributes: true, attributeFilter: ['class'] }); });
  }

  function boot() {
    wrapStart();
    ensureRow();
    watchStop();
  }

  function revert() {
    safe(function () { if (stopWatch) stopWatch.disconnect(); });
    stopWatch = null;
    safe(function () {
      wrapped.forEach(function (w) {
        try { w.proto.start = w.orig; } catch (e) {}
        try { delete w.proto.__mlsTurnsStartWrapped; } catch (e) {}
      });
      wrapped = [];
    });
    safe(function () { var r = $(ROW_ID); if (r && r.parentNode) r.parentNode.removeChild(r); });
    safe(function () { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { var b = $('captureBtn'); if (b) delete b.__mlsTurnsWatched; });
    safe(function () { window.__mlsTurns.installed = false; });
  }

  window.__mlsTurns = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    /* the honest contract, machine-readable so a caller cannot overclaim */
    basis: 'pause',
    diarization: false,
    gapMs: TURN_GAP_MS,
    header: HEADER,
    _testForce: false,
    record: record,
    turns: function () { return turns.map(function (t) { return { text: t.text, at: t.at, gapMs: t.gapMs, basis: t.basis, label: t.label, assumed: t.assumed }; }); },
    labels: function () { return labels.slice(); },
    setLabel: setLabel,
    cycleLabel: cycleLabel,
    raw: raw,
    render: render,
    apply: apply,
    unapply: unapply,
    isApplied: function () { return applied; },
    boxMatchesRender: boxMatchesRender,
    reset: reset,
    paint: paint,
    mount: boot,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
