/* feat_mls_note_jump.js — item50
 * Generated-note section quick-jump chips.
 * The generated clinical note renders as a formatted, sectioned view
 * (div.mlsf-note with div.mlsf-h section headers: Chief Complaint, HPI, ROS,
 * Physical Exam, Assessment, Plan, ...). On a long note the doctor has to
 * scroll and hunt for the section they want to review or sign off on.
 * This adds a compact row of clickable chips at the top of the note — one per
 * detected section — that smooth-scroll the note straight to that section and
 * briefly highlight its header. One click to Assessment & Plan instead of
 * scrolling. Pure navigation aid: it never edits the note content.
 * Reads the note's own rendered headers (single source: the formatted note).
 * Additive, reversible: window.__mlsNoteJump.revert()
 */
(function () {
  if (window.__mlsNoteJump && window.__mlsNoteJump.__live) return;

  var BAR_ID = 'mlsNoteJumpBar';
  var STYLE_ID = 'mlsNoteJump-style';
  var timer = null;
  var lastSig = '';

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + BAR_ID + '{display:flex;align-items:center;gap:7px;flex-wrap:wrap;',
      'margin:0 0 10px 0;padding:0;}',
      '#' + BAR_ID + ' .mlsnj-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;',
      'font-weight:700;opacity:.5;margin-right:2px;}',
      '#' + BAR_ID + ' .mlsnj-chip{cursor:pointer;display:inline-flex;align-items:center;',
      'padding:3px 10px;border-radius:999px;font-weight:600;font-size:12px;line-height:1.3;',
      'background:rgba(139,92,246,.12);color:#C9DCD2;border:1px solid rgba(139,92,246,.30);',
      'transition:background .12s,transform .12s;}',
      '#' + BAR_ID + ' .mlsnj-chip:hover{background:rgba(139,92,246,.24);}',
      '#' + BAR_ID + ' .mlsnj-chip:active{transform:translateY(1px);}',
      '.mlsnj-target{transition:box-shadow .2s,background .2s;}',
      '.mlsnj-flash{box-shadow:0 0 0 2px rgba(139,92,246,.55);border-radius:8px;',
      'background:rgba(139,92,246,.12)!important;}'
    ].join('');
    document.head.appendChild(s);
  }

  function noteFmt() { return document.querySelector('#noteCard .mlsf-note, .mlsf-note'); }

  function headers(fmt) {
    return [].slice.call(fmt.querySelectorAll('.mlsf-h')).filter(function (h) {
      return h.offsetParent !== null && (h.textContent || '').trim();
    });
  }

  function prettyLabel(txt) {
    var t = (txt || '').trim().replace(/[:：]\s*$/, '');
    var low = t.toLowerCase();
    var map = {
      'chief complaint': 'CC', 'history of present illness': 'HPI', 'hpi': 'HPI',
      'review of systems': 'ROS', 'ros': 'ROS', 'physical exam': 'Exam',
      'physical examination': 'Exam', 'assessment and plan': 'A/P',
      'assessment & plan': 'A/P', 'past medical history': 'PMH'
    };
    if (map[low]) return map[low];
    // Title-case, keep it short
    var tc = low.replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
    return tc.length > 20 ? tc.slice(0, 19) + '…' : tc;
  }

  function build() {
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('aria-label', 'Jump to note section');
    bar.addEventListener('click', function (e) {
      var c = e.target.closest && e.target.closest('.mlsnj-chip');
      if (!c) return;
      var i = +c.getAttribute('data-i');
      if (bar._heads && bar._heads[i]) jumpTo(bar._heads[i]);
    });
    return bar;
  }

  function jumpTo(h) {
    try { h.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (e) { h.scrollIntoView(); }
    h.classList.add('mlsnj-target', 'mlsnj-flash');
    setTimeout(function () { h.classList.remove('mlsnj-flash'); }, 900);
  }

  function place(bar, fmt) {
    if (fmt.previousElementSibling !== bar || bar.parentNode !== fmt.parentNode) {
      fmt.parentNode.insertBefore(bar, fmt);
    }
  }

  function render() {
    if (window.__mlsNoteJump && window.__mlsNoteJump.__reverted) return;
    var fmt = noteFmt();
    var bar = document.getElementById(BAR_ID);
    if (!fmt || fmt.offsetParent === null) { if (bar) bar.style.display = 'none'; lastSig = ''; return; }

    var heads = headers(fmt);
    var sig = heads.map(function (h) { return (h.textContent || '').trim(); }).join('|');

    if (heads.length < 2) { if (bar) bar.style.display = 'none'; lastSig = ''; return; }
    if (bar && bar.style.display !== 'none' && sig === lastSig) { place(bar, fmt); return; }
    lastSig = sig;

    if (!bar) bar = build();
    place(bar, fmt);
    bar.style.display = '';
    var html = '<span class="mlsnj-lbl">Jump to</span>';
    heads.forEach(function (h, i) {
      html += '<span class="mlsnj-chip" data-i="' + i + '" role="button" tabindex="0">' +
        esc(prettyLabel(h.textContent)) + '</span>';
    });
    bar.innerHTML = html;
    bar._heads = heads;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function start() { css(); render(); if (timer) clearInterval(timer); timer = setInterval(render, 900); }

  window.__mlsNoteJump = {
    __live: true,
    __reverted: false,
    render: render,
    revert: function () {
      this.__reverted = true;
      this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var b = document.getElementById(BAR_ID); if (b) b.remove();
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
      [].slice.call(document.querySelectorAll('.mlsnj-flash,.mlsnj-target')).forEach(function (e) {
        e.classList.remove('mlsnj-flash', 'mlsnj-target');
      });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
