/* feat_mls_billing_gate.js  ->  window.__mlsBillingGate   (bg-1.0.0)
 * ---------------------------------------------------------------------------
 * THE CHECK THAT WAS MISSING BETWEEN THE CODES AND THE CHART.
 *
 * The Superbill freezes an exact E/M + CPT payload and the doctor carries it
 * into athenaOne's billing slate. Until now the only thing standing between a
 * suggested code and that slate was `_athenaCanonicalBilling`, which checks that
 * each code is SHAPED like a code — five characters, at least one digit — and
 * nothing else. So a payload could reach the chart carrying:
 *
 *   • 64484 with no 64483 on it — an add-on level with no primary, which is an
 *     automatic denial (CO-B15);
 *   • 77003 beside 64483 — fluoroscopic guidance that is already inside 64483's
 *     own descriptor, which is an automatic denial (CO-97);
 *   • an office visit on an injection day with no modifier 25, which does not
 *     reduce the visit charge, it deletes it;
 *   • a bilateral procedure with no modifier 50, which pays a third less and
 *     generates NO denial at all — the money simply never gets billed.
 *
 * This module asks the backend engine (POST /api/coding/validate) and shows the
 * answer in the Superbill before anything is frozen.
 *
 * WHAT IT WILL AND WILL NOT DO
 *   - It BLOCKS the Athena review when the engine returns a hard block, and
 *     names the code and the fix.
 *   - It WARNS without blocking on anything the engine is not certain of.
 *   - It NEVER edits the doctor's codes. It never appends a modifier — modifier
 *     25 and KX assert facts about documentation only the doctor can know.
 *   - It FAILS OPEN, loudly. If the check cannot run (offline, signed out,
 *     server error) the Superbill still works and says plainly that nothing was
 *     checked. "Not checked" is never allowed to look like "clean".
 *
 * SAFETY: no Athena calls, no writes, no PHI. It sends billing codes and
 * receives findings; no patient name, date of birth or note text crosses the
 * boundary. Additive, idempotent, reversible: __mlsBillingGate.revert().
 */
(function () {
  'use strict';
  try { if (window.__mlsBillingGate && window.__mlsBillingGate.installed) return; } catch (e) { return; }

  var VERSION = 'bg-1.0.0';
  var STYLE_ID = 'mlsBillingGateCss';

  function S(x) { return x == null ? '' : String(x); }
  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function callG(n) { return safe(function () { return isFn(window[n]) ? window[n]() : null; }, null); }
  function bkBase() { return callG('bkBase') || 'https://scrivara-backend.onrender.com'; }
  function bkToken() { return callG('bkToken') || ''; }
  function esc(s) {
    return S(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------ styles */
  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.mlsbg{margin-top:10px;border-radius:10px;overflow:hidden;border:1px solid #e2e8f2;font-size:13px;line-height:1.45}',
      '.mlsbg-hd{display:flex;align-items:center;gap:8px;padding:8px 11px;font-weight:700}',
      '.mlsbg-hd .mlsbg-n{margin-left:auto;font-weight:600;opacity:.75;font-size:12px}',
      '.mlsbg-block .mlsbg-hd{background:#fdecec;color:#8f2020}',
      '.mlsbg-review .mlsbg-hd{background:#fdf6e3;color:#7a5c08}',
      '.mlsbg-allow .mlsbg-hd{background:#eef7f1;color:#1f4034}',
      '.mlsbg-unknown .mlsbg-hd{background:#f2f4f8;color:#414a5a}',
      '.mlsbg-body{background:#fff;padding:0}',
      '.mlsbg-item{padding:9px 11px;border-top:1px solid #eef1f6}',
      '.mlsbg-item:first-child{border-top:0}',
      '.mlsbg-tag{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:1px 6px;border-radius:999px;margin-right:7px;vertical-align:1px}',
      '.mlsbg-t-block{background:#fdecec;color:#8f2020}',
      '.mlsbg-t-warn{background:#fdf6e3;color:#7a5c08}',
      '.mlsbg-t-advisory{background:#f2f4f8;color:#414a5a}',
      '.mlsbg-codes{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#2E6A4B;font-weight:700}',
      '.mlsbg-fix{margin-top:4px;color:#414a5a}',
      '.mlsbg-fix b{color:#1f4034}',
      '.mlsbg-meta{margin-top:3px;font-size:11.5px;color:#7b8494}',
      '.mlsbg-foot{padding:8px 11px;background:#fafbfd;border-top:1px solid #eef1f6;font-size:11.5px;color:#7b8494}',
      '.mlsbg-more{display:block;width:100%;text-align:left;padding:7px 11px;background:#fafbfd;border:0;border-top:1px solid #eef1f6;font:inherit;font-size:12px;color:#2E6A4B;cursor:pointer}',
      '.mlsbg-more:hover{background:#f2f6f3}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------- build the claim payload */
  /* Codes only. A name, a date of birth or note text must never reach this
     endpoint, so the claim is assembled field by field rather than by passing
     the coding object through. */
  function claimFrom(coding, canonical) {
    var c = coding || {};
    var out = { em: '', emModifiers: [], lines: [], icd10: [], pos: '', facts: {} };

    out.em = S(canonical && canonical.emCode) || '';

    // Prefer the structured lines when the note produced them; fall back to the
    // frozen bare-code list so this still works on an older note.
    var lines = [];
    if (canonical && canonical.lines && canonical.lines.length) {
      lines = canonical.lines;
    } else if (Array.isArray(c.cptLines) && c.cptLines.length) {
      lines = c.cptLines;
    } else {
      lines = (canonical && canonical.cptCodes ? canonical.cptCodes : []).map(function (code) {
        return { code: code };
      });
    }
    if (out.em) {
      var emMods = [];
      for (var i = 0; i < lines.length; i++) {
        if (S(lines[i] && lines[i].code) === out.em && lines[i].modifiers) emMods = lines[i].modifiers;
      }
      if (!emMods.length && Array.isArray(c.em_modifiers)) emMods = c.em_modifiers;
      if (!emMods.length && Array.isArray(c.emModifiers)) emMods = c.emModifiers;
      out.emModifiers = emMods.slice(0, 4);
      var hasEmLine = lines.some(function (l) { return S(l && l.code) === out.em; });
      if (!hasEmLine) lines = [{ code: out.em, modifiers: out.emModifiers }].concat(lines);
    }
    out.lines = lines.slice(0, 40).map(function (l) {
      var o = (l && typeof l === 'object') ? l : { code: l };
      return {
        code: S(o.code).slice(0, 10),
        units: Number(o.units) > 0 ? Number(o.units) : 1,
        modifiers: (Array.isArray(o.modifiers) ? o.modifiers : []).slice(0, 4).map(function (m) { return S(m).toUpperCase(); }),
        side: S(o.side || '').toLowerCase(),
        levels: (Array.isArray(o.levels) ? o.levels : []).slice(0, 8).map(function (x) { return S(x).slice(0, 16); })
      };
    });

    var icd = Array.isArray(c.icd) ? c.icd : (Array.isArray(c.icd10) ? c.icd10 : []);
    out.icd10 = icd.slice(0, 24).map(function (d) {
      return S(d && typeof d === 'object' ? d.code : d).split(/[\s—:,-]/)[0].slice(0, 10);
    }).filter(Boolean);

    out.pos = S(c.place_of_service || c.pos || '').slice(0, 4);
    var f = c.procedure_facts || c.facts || null;
    if (f && typeof f === 'object') {
      out.facts = {
        imagingUsed: f.imaging_used || f.imagingUsed || undefined,
        permanentImageRecorded: typeof (f.permanent_image_recorded != null ? f.permanent_image_recorded : f.permanentImageRecorded) === 'boolean'
          ? (f.permanent_image_recorded != null ? f.permanent_image_recorded : f.permanentImageRecorded) : undefined,
        rfaType: f.rfa_type || f.rfaType || undefined,
        emSeparatelyDocumented: typeof (f.em_separately_documented != null ? f.em_separately_documented : f.emSeparatelyDocumented) === 'boolean'
          ? (f.em_separately_documented != null ? f.em_separately_documented : f.emSeparatelyDocumented) : undefined,
        diagnosticBlock: typeof (f.diagnostic_block != null ? f.diagnostic_block : f.diagnosticBlock) === 'boolean'
          ? (f.diagnostic_block != null ? f.diagnostic_block : f.diagnosticBlock) : undefined
      };
    }
    return out;
  }

  /* --------------------------------------------------------------- validate */
  /* Resolves to a result object ALWAYS — a network failure becomes
     {decision:'unknown'}, never a silent pass and never a thrown error that a
     caller might treat as "no problems found". */
  function validate(coding, canonical) {
    var claim = claimFrom(coding, canonical);
    if (!claim.lines.length && !claim.em) {
      return Promise.resolve({ decision: 'unknown', checked: false, findings: [],
        reason: 'There are no billing codes on this visit to check.' });
    }
    var token = bkToken();
    if (!token) {
      return Promise.resolve({ decision: 'unknown', checked: false, findings: [], claim: claim,
        reason: 'You are not signed in to MLS, so the billing check could not run. Nothing was checked — that is not the same as nothing being wrong.' });
    }
    return fetch(bkBase() + '/api/coding/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(claim)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!j || j.decision === 'error') {
          return { decision: 'unknown', checked: false, findings: [], claim: claim,
            reason: (j && j.message) || 'The billing check could not run. Nothing was checked — that is not the same as nothing being wrong.' };
        }
        j.checked = true;
        j.claim = claim;
        return j;
      }, function () {
        return { decision: 'unknown', checked: false, findings: [], claim: claim,
          reason: 'The billing check returned something MLS could not read, so nothing was checked.' };
      });
    }, function () {
      return { decision: 'unknown', checked: false, findings: [], claim: claim,
        reason: 'MLS could not reach the billing check (you may be offline). Nothing was checked — that is not the same as nothing being wrong.' };
    });
  }

  /* ----------------------------------------------------------------- render */
  var SEV_ORDER = { block: 0, warn: 1, advisory: 2 };
  var SEV_LABEL = { block: 'Will deny', warn: 'Check', advisory: 'Note' };

  function itemHtml(f) {
    var sev = f.severity === 'block' ? 'block' : f.severity === 'warn' ? 'warn' : 'advisory';
    var codes = (f.codes && f.codes.length) ? '<span class="mlsbg-codes">' + esc(f.codes.join(' · ')) + '</span> ' : '';
    var meta = [];
    if (f.denial && f.denial.carc) meta.push(esc(f.denial.carc) + ' — ' + esc(f.denial.meaning));
    if (f.confidence && f.confidence !== 'high' && f.confidence !== 'verified') meta.push('confidence: ' + esc(f.confidence));
    return '<div class="mlsbg-item">'
      + '<span class="mlsbg-tag mlsbg-t-' + sev + '">' + SEV_LABEL[sev] + '</span>'
      + codes + esc(f.message)
      + (f.fix ? '<div class="mlsbg-fix"><b>Do this:</b> ' + esc(f.fix) + '</div>' : '')
      + (meta.length ? '<div class="mlsbg-meta">' + meta.join(' · ') + '</div>' : '')
      + '</div>';
  }

  function render(el, result) {
    if (!el) return;
    css();
    if (!result) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = 'block';

    if (!result.checked) {
      el.className = 'mlsbg mlsbg-unknown';
      el.innerHTML = '<div class="mlsbg-hd">&#9888;&#65039; Billing not checked</div>'
        + '<div class="mlsbg-body"><div class="mlsbg-item">' + esc(result.reason || 'The billing check did not run.') + '</div></div>';
      return;
    }

    var findings = (result.findings || []).slice().sort(function (a, b) {
      return (SEV_ORDER[a.severity] || 2) - (SEV_ORDER[b.severity] || 2);
    });
    var nBlock = findings.filter(function (f) { return f.severity === 'block'; }).length;
    var nWarn = findings.filter(function (f) { return f.severity === 'warn'; }).length;
    var cls = nBlock ? 'block' : (nWarn ? 'review' : 'allow');
    el.className = 'mlsbg mlsbg-' + cls;

    var head = nBlock
      ? '&#10060; ' + nBlock + ' problem' + (nBlock === 1 ? '' : 's') + ' that will cost you this claim'
      : nWarn
        ? '&#9888;&#65039; ' + nWarn + ' thing' + (nWarn === 1 ? '' : 's') + ' to check'
        : '&#9989; Coding checks passed';

    // Blocks and warnings are always visible. Advisories collapse — they are
    // context, and burying the real problems under them is how a warning
    // surface stops being read.
    var primary = findings.filter(function (f) { return f.severity !== 'advisory'; });
    var advisories = findings.filter(function (f) { return f.severity === 'advisory'; });

    var cov = result.coverage || {};
    var uncheckedNote = (cov.codesUnchecked && cov.codesUnchecked.length)
      ? 'MLS has no reference data for ' + esc(cov.codesUnchecked.join(', ')) + ' and did not check '
        + (cov.codesUnchecked.length === 1 ? 'it' : 'them') + '.'
      : '';

    var html = '<div class="mlsbg-hd">' + head
      + '<span class="mlsbg-n">' + (cov.checkedCount != null ? cov.checkedCount + ' of ' + cov.totalCount + ' codes checked' : '') + '</span></div>'
      + '<div class="mlsbg-body">'
      + (primary.length ? primary.map(itemHtml).join('') : '<div class="mlsbg-item">Nothing on this claim looks like it will be denied for a coding reason.</div>')
      + '</div>';

    if (advisories.length) {
      html += '<button type="button" class="mlsbg-more" data-mlsbg-toggle="1">'
        + 'Show ' + advisories.length + ' further note' + (advisories.length === 1 ? '' : 's') + ' &#9662;</button>'
        + '<div class="mlsbg-body" data-mlsbg-adv="1" style="display:none">' + advisories.map(itemHtml).join('') + '</div>';
    }
    html += '<div class="mlsbg-foot">' + (uncheckedNote ? uncheckedNote + ' ' : '')
      + esc((result.engine && result.engine.disclaimer) || '') + '</div>';

    el.innerHTML = html;
    var btn = el.querySelector('[data-mlsbg-toggle]');
    if (btn) {
      btn.addEventListener('click', function () {
        var body = el.querySelector('[data-mlsbg-adv]');
        if (!body) return;
        var open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        btn.innerHTML = (open ? 'Show ' : 'Hide ') + advisories.length + ' further note'
          + (advisories.length === 1 ? '' : 's') + (open ? ' &#9662;' : ' &#9652;');
      });
    }
  }

  /* --------------------------------------------------- the write-back gate */
  /* Called by pushSuperbillToAthena before the payload is handed to the
     confirmation flow. Returns {allow:boolean, reason:string}. */
  var lastResult = null;
  function lastAudit() { return lastResult; }
  function setLast(r) { lastResult = r; return r; }

  function gateDecision(result) {
    if (!result) {
      return { allow: true, checked: false,
        reason: 'The billing check has not run for this Superbill. Nothing was checked.' };
    }
    if (!result.checked) {
      // Fail OPEN but loud: an outage must not stop the doctor working, and
      // must not be mistaken for a clean bill of health.
      return { allow: true, checked: false, reason: result.reason || 'Nothing was checked.' };
    }
    var blocks = (result.findings || []).filter(function (f) { return f.severity === 'block'; });
    if (!blocks.length) return { allow: true, checked: true, reason: '' };
    return {
      allow: false, checked: true, blocks: blocks,
      reason: blocks.length + ' coding problem' + (blocks.length === 1 ? '' : 's')
        + ' would deny this claim: ' + blocks.map(function (b) {
          return (b.codes && b.codes.length ? b.codes.join('+') + ' — ' : '') + b.message;
        }).join(' ') + ' Correct the coding, or confirm you have reviewed it and want to proceed anyway.'
    };
  }

  /* Run the check and paint it into the Superbill. Returns the promise so the
     caller can await the result before freezing a payload. */
  function check(coding, canonical, el) {
    return validate(coding, canonical).then(function (result) {
      setLast(result);
      if (el) render(el, result);
      return result;
    }, function () {
      var r = { decision: 'unknown', checked: false, findings: [],
        reason: 'The billing check failed to run. Nothing was checked.' };
      setLast(r);
      if (el) render(el, r);
      return r;
    });
  }

  function revert() {
    try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { delete window.__mlsBillingGate; } catch (e2) { window.__mlsBillingGate = undefined; }
  }

  window.__mlsBillingGate = {
    installed: true, version: VERSION,
    validate: validate, render: render, check: check,
    claimFrom: claimFrom, gateDecision: gateDecision, lastAudit: lastAudit,
    revert: revert
  };
})();
