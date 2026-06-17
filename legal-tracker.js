/* ===========================================================================
   MLS — Legal Case Progress Tracker  (additive progressive enhancement)
   ---------------------------------------------------------------------------
   Defines a single global: window.mlsLegalTracker(rq, mode) -> HTML string.
   It renders a friendly horizontal stepper / status timeline for one legal
   (IME / expert / record-review) request. It is called from legalReqRowHtml()
   so the SAME tracker shows on the DOCTOR side (#legalReqList) and the
   LAWYER portal side (#lawReqList) — both read the identical backend status.

   Steps map 1:1 to REAL backend signals returned by GET /api/legal/requests
   (no invented statuses):
     1. Request submitted        <- the request row exists
     2. Authorization received   <- rq.has_authorization  (legal_attachments
                                    category='authorization'; the §34 HIPAA
                                    consent gate enforced before fulfill)
     3. Report signed & delivered<- rq.status === 'fulfilled' (fulfilled_at,
                                    result_* encrypted & delivered to attorney)
     4. Payment complete         <- rq.paid === true (5% Connect pay path)

   The current step shows a plain-language "who's next" hint (doctor / attorney
   / patient). Pure, defensive function: returns '' on any error so it can
   never break the host app. No PHI, no secrets, no network calls.
   ======================================================================== */
(function () {
  if (window.__mlsLegalTrackerInit) return;
  window.__mlsLegalTrackerInit = true;

  /* Inject the stylesheet once (themed with the app's CSS variables). */
  try {
    if (!document.getElementById('mls-legal-tracker-style')) {
      var st = document.createElement('style');
      st.id = 'mls-legal-tracker-style';
      st.textContent = [
        '.mlt-wrap{flex-basis:100%;width:100%;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}',
        '.mlt-head{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}',
        '.mlt-steps{display:flex;align-items:flex-start;gap:0}',
        '.mlt-step{flex:1 1 0;position:relative;text-align:center;padding:0 2px;min-width:0}',
        '.mlt-step::before{content:"";position:absolute;top:13px;right:50%;width:100%;height:3px;background:var(--line);z-index:0;border-radius:3px}',
        '.mlt-step:first-child::before{display:none}',
        '.mlt-step.is-done::before{background:var(--green,#1f7a4d)}',
        '.mlt-step.is-current::before{background:var(--green,#1f7a4d)}',
        '.mlt-dot{position:relative;z-index:1;width:28px;height:28px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:var(--card,#fff);border:2px solid var(--line);color:var(--muted);box-sizing:border-box;transition:all .15s ease}',
        '.is-done .mlt-dot{background:var(--green,#1f7a4d);border-color:var(--green,#1f7a4d);color:#fff}',
        '.is-current .mlt-dot{background:var(--brand,#2563eb);border-color:var(--brand,#2563eb);color:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--brand,#2563eb) 22%,transparent)}',
        '.mlt-label{margin-top:7px;font-size:11.5px;line-height:1.3;color:var(--muted);font-weight:600}',
        '.is-done .mlt-label{color:var(--ink)}',
        '.is-current .mlt-label{color:var(--brand-dk,var(--brand,#1d4ed8));font-weight:700}',
        '.mlt-next{margin-top:12px;font-size:12.5px;line-height:1.45;color:var(--ink);background:var(--soft,var(--field-bg,#f6f8fa));border:1px solid var(--line);border-radius:10px;padding:8px 11px;display:flex;gap:8px;align-items:flex-start}',
        '.mlt-next b{color:var(--brand-dk,var(--brand,#1d4ed8))}',
        '.mlt-next.is-complete{background:color-mix(in srgb,var(--green,#1f7a4d) 12%,transparent);border-color:var(--green,#1f7a4d)}',
        '@media(max-width:640px){',
        '.mlt-steps{flex-direction:column;gap:0;align-items:stretch}',
        '.mlt-step{display:flex;align-items:center;gap:11px;text-align:left;padding:5px 0;min-height:32px}',
        '.mlt-step::before{top:auto;bottom:50%;right:auto;left:13px;width:3px;height:100%}',
        '.mlt-step:first-child::before{display:none}',
        '.mlt-dot{margin:0;flex:0 0 auto}',
        '.mlt-label{margin-top:0}',
        '}'
      ].join('');
      (document.head || document.documentElement).appendChild(st);
    }
  } catch (e) { /* styling is best-effort */ }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  window.mlsLegalTracker = function (rq, mode) {
    try {
      if (!rq) return '';
      mode = (mode === 'lawyer') ? 'lawyer' : 'clinician';

      var status = String(rq.status || 'pending').toLowerCase();
      var fulfilled = (status === 'fulfilled' || status === 'done' ||
                       status === 'complete' || !!rq.result_text);
      var hasAuth = (rq.has_authorization === true || rq.has_authorization === 1 ||
                     rq.hasAuthorization === true);
      var paid = (rq.paid === true || rq.paid === 1);

      /* Ordered milestones — each tied to a real backend signal. */
      var steps = [
        { key: 'submitted', label: 'Request submitted',           done: true },
        { key: 'auth',      label: 'Authorization received',       done: hasAuth },
        { key: 'report',    label: 'Report signed &amp; delivered', done: fulfilled },
        { key: 'paid',      label: 'Payment complete',             done: paid }
      ];

      /* Current step = first not-done (or none when the case is complete). */
      var curIdx = -1;
      for (var i = 0; i < steps.length; i++) { if (!steps[i].done) { curIdx = i; break; } }

      /* Plain-language "who's next" hint, written for whoever is viewing. */
      var hint;
      if (curIdx === -1) {
        hint = '<div class="mlt-next is-complete">✅ <span>This case is complete — the signed report was delivered and payment is settled.</span></div>';
      } else {
        var key = steps[curIdx].key, txt = '';
        if (key === 'auth') {
          txt = (mode === 'lawyer')
            ? 'Next: <b>you (the attorney)</b> upload the signed patient authorization / release so the physician can release records.'
            : 'Next: <b>the attorney &amp; patient</b> — a signed patient authorization must be on file before the report can be delivered.';
        } else if (key === 'report') {
          txt = (mode === 'lawyer')
            ? 'Next: <b>the physician</b> is preparing and signing your report.'
            : 'Next: <b>you (the physician)</b> — prepare, sign, and send the report to the attorney.';
        } else if (key === 'paid') {
          txt = (mode === 'lawyer')
            ? 'Next: <b>you (the attorney)</b> pay the engagement fee to unlock the full signed report.'
            : 'Next: <b>the attorney</b> pays the engagement fee to unlock the full report.';
        }
        hint = '<div class="mlt-next">➡️ <span>' + txt + '</span></div>';
      }

      var nodes = steps.map(function (s, i) {
        var cls = s.done ? 'is-done' : (i === curIdx ? 'is-current' : 'is-todo');
        var inner = s.done ? '✓' : String(i + 1);
        return '<div class="mlt-step ' + cls + '">' +
                 '<div class="mlt-dot">' + inner + '</div>' +
                 '<div class="mlt-label">' + s.label + '</div>' +
               '</div>';
      }).join('');

      return '<div class="mlt-wrap" role="group" aria-label="Case progress">' +
               '<div class="mlt-head">⚖️ Case progress</div>' +
               '<div class="mlt-steps">' + nodes + '</div>' +
               hint +
             '</div>';
    } catch (e) { return ''; }
  };
})();
