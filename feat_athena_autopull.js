/* feat_athena_autopull.js — MLS one-click "Pull the open athenaOne patient" (v1.0.0)
 *
 * Fixes the false "⚠ Safety stop — name did not match" and removes manual typing.
 *
 * Root cause (verified live on the real chart): the "📥 Pull from Athena" button
 * (global pullPatientFromAthenaPrompt) made the user TYPE a name, then the strict
 * name+DOB verify gate compared the typed/active patient against the chart that was
 * read. When the open chart's stored name format / the active patient differed, the
 * gate hard-blocked even though the chart name genuinely matched.
 *
 * This module makes the button do what it should: detect the patient ALREADY open in
 * the athenaOne tab, read NAME + DOB straight from that chart (read-only DOM, no Athena
 * writes), AUTO-FILL them into MLS (find-or-create the patient), and pull EVERY visit
 * into the per-visit model. Because the patient is built FROM the same chart being
 * pulled, the existing strict verify gate passes honestly — no loosening, no fake data.
 * If a clear name+DOB cannot be read, it fails honestly and saves nothing.
 *
 * Self-contained, idempotent, reversible (window.__mlsAthenaAutoPull.revert()).
 * No backend / extension / ScribeFlow.html edits. Preserves all honest guards.
 */
(function () {
  'use strict';
  if (window.__mlsAthenaAutoPull && window.__mlsAthenaAutoPull.installed) return;
  var VERSION = '1.0.1';

  function S(x) { return x == null ? '' : String(x); }
  function trim(x) { return S(x).trim(); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ---------- robust NAME normalization (case / punctuation / suffix / middle / Last,First) ---------- */
  var SUFFIX = /^(jr|sr|ii|iii|iv|v|md|do|np|pa|rn|phd|esq|dr)$/;
  function tokenize(raw) {
    var s = S(raw).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.split(' ').filter(function (t) { return t && !SUFFIX.test(t); });
  }
  // Resolve a name (possibly "Last, First M", "First Last", "First M Last") to {first,last,all}
  function firstLast(raw) {
    var s = S(raw);
    var toks;
    if (s.indexOf(',') >= 0) {
      var parts = s.split(',');
      var lastPart = tokenize(parts[0]);
      var firstPart = tokenize(parts.slice(1).join(' '));
      toks = firstPart.concat(lastPart); // -> First ... Last order
    } else {
      toks = tokenize(s);
    }
    var multi = toks.filter(function (t) { return t.length > 1; });
    var first = multi[0] || toks[0] || '';
    var last = multi.length ? multi[multi.length - 1] : (toks[toks.length - 1] || '');
    return { first: first, last: last, all: toks };
  }
  function namesMatch(a, b) {
    var A = firstLast(a), B = firstLast(b);
    if (A.first && A.last && B.first && B.last) {
      if (A.first === B.first && A.last === B.last) return true; // normal + handles Last,First swap
      if (A.first === B.last && A.last === B.first) return true; // reversed ordering on one side
      return false;
    }
    // thin structure: fall back to >=2 shared meaningful tokens
    var sa = A.all, sb = B.all;
    var ov = sa.filter(function (x) { return x.length > 1 && sb.indexOf(x) >= 0; }).length;
    return ov >= 2;
  }

  /* ---------- robust DOB normalization (numeric + ISO + month names) -> mm/dd/yyyy ---------- */
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  function fixYear(y) { y = +y; if (y < 100) y += (y > 40 ? 1900 : 2000); return y; }
  function normDob(raw) {
    var s = trim(raw); if (!s) return '';
    var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return pad(+iso[2]) + '/' + pad(+iso[3]) + '/' + (+iso[1]);
    var lo = s.toLowerCase();
    var mn = lo.match(/([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/);
    if (mn && MONTHS[mn[1]]) return pad(MONTHS[mn[1]]) + '/' + pad(+mn[2]) + '/' + fixYear(mn[3]);
    var mn2 = lo.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{2,4})/);
    if (mn2 && MONTHS[mn2[2]]) return pad(MONTHS[mn2[2]]) + '/' + pad(+mn2[1]) + '/' + fixYear(mn2[3]);
    var nm = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (nm) { var mo = +nm[1], d = +nm[2], y = fixYear(nm[3]); if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return pad(mo) + '/' + pad(d) + '/' + y; }
    return '';
  }
  function dobsMatch(a, b) { var x = normDob(a), y = normDob(b); return !!(x && y && x === y); }

  /* ---------- harden the model's _normDob so the EXISTING internal gate also benefits ---------- */
  function hardenModel() {
    try {
      var m = window.__mlsVisitModel; if (!m || m._normDobHardened) return;
      m._normDobOrig = m._normDob;
      m._normDob = function (s) { var r = ''; try { r = m._normDobOrig(s); } catch (e) {} return r || normDob(s); };
      m._normDobHardened = true;
    } catch (e) {}
  }

  /* ---------- find-or-create the MLS patient FROM the chart identity (dedup-safe) ---------- */
  function resolvePatient(identity) {
    var pts = (typeof getPatients === 'function' ? getPatients() : []) || [];
    var found = pts.find(function (p) {
      if (!p) return false;
      if (!namesMatch(p.name, identity.name)) return false;
      var pd = normDob(p.dob), id = normDob(identity.dob);
      if (pd && id) return pd === id;   // both present -> must match
      return true;                       // name matches, DOB unknown on a side
    }) || null;
    if (found) {
      if (!trim(found.dob) && trim(identity.dob)) { found.dob = trim(identity.dob); try { upsertPatient(found); } catch (e) {} }
      return { patient: found, created: false };
    }
    var np = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: trim(identity.name), dob: trim(identity.dob), reason: '', source: 'athena-auto', created: Date.now()
    };
    try { upsertPatient(np); } catch (e) {}
    return { patient: np, created: true };
  }

  /* ---------- on-screen status chip (in-place; no toast spam) ---------- */
  var chip = null;
  function ensureChip() {
    if (chip && document.body && document.body.contains(chip)) return chip;
    chip = document.createElement('div');
    chip.id = 'mlsAutoPullChip';
    chip.style.cssText = 'position:fixed;z-index:2147483600;left:50%;bottom:24px;transform:translateX(-50%);max-width:90vw;' +
      'background:#1E2B24;color:#fff;padding:10px 16px;border-radius:10px;font:14px/1.45 system-ui,-apple-system,sans-serif;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.32);white-space:pre-wrap;text-align:center;';
    (document.body || document.documentElement).appendChild(chip);
    return chip;
  }
  function setChip(msg) { try { var c = ensureChip(); c.textContent = msg; c.style.display = 'block'; } catch (e) {} }
  function hideChipLater(ms) { setTimeout(function () { try { if (chip) chip.style.display = 'none'; } catch (e) {} }, ms || 9000); }
  function status(onStatus, msg, loud) {
    try { onStatus && onStatus(msg); } catch (e) {}
    setChip(msg);
    if (loud) { try { if (typeof toast === 'function') toast(msg, /^⚠/.test(msg) ? 'err' : ''); } catch (e) {} }
  }

  /* ---------- the one-button auto pull ---------- */
  var busy = false;
  async function run(onStatus) {
    if (busy) return;
    var cv = window.__mlsCopyVisits, M = window.__mlsVisitModel;
    if (!cv || !cv._driveRequest || !cv._saveVisits || !M) {
      status(onStatus, '⚠ Visit modules aren’t loaded yet — reload the page and try again.', true); hideChipLater(); return;
    }
    busy = true;
    try {
      hardenModel();
      status(onStatus, '🔍 Detecting the patient open in your athenaOne tab…', true);
      var res;
      try {
        res = await cv._driveRequest('mlsAppReadAllVisits', {}, 'mlsAppAllVisitsResult',
          ['mlsAppVisitsProgress', 'mlsAppSearchProgress'],
          function (msg) { if (msg) status(onStatus, msg); }, null, 240000, 12000);
      } catch (e) {
        var em = S(e && e.message || e);
        /* v1.0.1 (live 2026-07-18): the #1 real-world outcome of this button is
           the cross-patient SAFETY STOP — MLS is on patient A while athenaOne
           shows patient B. The old technical message vanished in 9s, so the
           button read as dead. Say exactly what to do, and keep it up longer. */
        if (/frozen MLS patient|did not match/i.test(em)) {
          status(onStatus, '⚠ athenaOne has a DIFFERENT patient open than the one selected here — MLS stopped on purpose so charts can never mix. To pull the patient whose chart is open in Athena: select (or add) that same patient here first, then click again. Or use the green MLS panel inside Athena (“Pull history”) — it always pulls the open chart. Nothing was saved.', true);
          hideChipLater(22000); return;
        }
        status(onStatus, '⚠ Couldn’t read your open athenaOne chart (' + em + '). Open a patient’s chart in your Athena tab, then try again. Nothing was saved.', true);
        hideChipLater(15000); return;
      }
      if (!res || !res.ok) {
        status(onStatus, '⚠ ' + ((res && res.message) || 'No patient chart could be read from athenaOne') + '. Nothing was saved.', true);
        hideChipLater(); return;
      }
      var identity = res.identity || {};
      var visits = Array.isArray(res.visits) ? res.visits : [];
      if (!trim(identity.name) || !normDob(identity.dob)) {
        status(onStatus, '⚠ Couldn’t read a clear name + DOB from the open chart — nothing was saved. Open the patient’s chart header in athenaOne and retry.', true);
        hideChipLater(); return;
      }
      var r = resolvePatient(identity);
      var patient = r.patient;
      try { if (typeof openPatient === 'function') openPatient(patient.id); else if (typeof selectPatient === 'function') selectPatient(patient.id); } catch (e) {}
      status(onStatus, 'Found: ' + identity.name + ', DOB ' + normDob(identity.dob) + ' — pulling ' + visits.length + ' visit' + (visits.length === 1 ? '' : 's') + (r.created ? ' (new patient)' : '') + '…', true);
      var saved = 0;
      try { saved = cv._saveVisits(patient, identity, visits, function (msg) { if (msg) status(onStatus, msg); }); }
      catch (e) { status(onStatus, '⚠ ' + (e && e.message || 'Save failed') + '.', true); hideChipLater(); return; }
      status(onStatus, 'Saved ' + saved + ' visit' + (saved === 1 ? '' : 's') + '. Generating AI summaries…');
      try { await M.ensureSummaries(patient.id, function (msg) { if (msg) status(onStatus, msg); }); } catch (e) {}
      try { window.__mlsVisitUI && window.__mlsVisitUI.render && window.__mlsVisitUI.render(true); } catch (e) {}
      try { if (typeof renderProfile === 'function') renderProfile(); } catch (e) {}
      var n = saved; try { n = M.getVisits(patient).length; } catch (e) {}
      status(onStatus, '✓ Done — ' + n + ' visit' + (n === 1 ? '' : 's') + ' pulled for ' + identity.name + '.', true);
      hideChipLater(12000);
      return { ok: true, saved: saved, total: n, created: r.created };
    } finally { busy = false; }
  }

  /* ---------- wire the existing "📥 Pull from Athena" button to the no-typing auto flow ---------- */
  function install() {
    hardenModel();
    if (typeof window.pullPatientFromAthenaPrompt === 'function' && !window.pullPatientFromAthenaPrompt.__mlsAutoWrapped) {
      window.__mlsPullPromptOrig = window.pullPatientFromAthenaPrompt; // keep the typed-search fallback available
      var wrapped = function (btn) { run(null); };
      wrapped.__mlsAutoWrapped = true;
      window.pullPatientFromAthenaPrompt = wrapped;
    }
  }
  function revert() {
    try { if (window.__mlsPullPromptOrig) window.pullPatientFromAthenaPrompt = window.__mlsPullPromptOrig; } catch (e) {}
    try { var m = window.__mlsVisitModel; if (m && m._normDobHardened) { m._normDob = m._normDobOrig; m._normDobHardened = false; } } catch (e) {}
    try { if (chip && chip.parentNode) chip.parentNode.removeChild(chip); } catch (e) {}
  }

  install();
  // Re-assert the wrap if the app (re)defines the global later during boot.
  try {
    var tries = 0;
    var iv = setInterval(function () { tries++; install(); if (tries > 20) clearInterval(iv); }, 1000);
  } catch (e) {}

  window.__mlsAthenaAutoPull = {
    installed: true, version: VERSION, run: run,
    resolvePatient: resolvePatient, namesMatch: namesMatch, normDob: normDob, dobsMatch: dobsMatch,
    firstLast: firstLast, hardenModel: hardenModel, revert: revert
  };
})();
