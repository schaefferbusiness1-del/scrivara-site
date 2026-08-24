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
 *
 * v1.1.0 (2026-08-19, owner directives): cp-1.1 the button checks WHO is open
 * FIRST and asks for what it needs AT THE CLICK (never drives a doomed walk,
 * never warns after the fact); rt-1.1 one engine-refreshed retry when the read
 * fails hydration-shaped (extension 3.0.74 mlsAppAthenaRefreshV1); tm-1.1 the
 * mismatch message tells the mid-walk truth at the SOURCE (the old sentence
 * blamed "a DIFFERENT patient open", which detect-3072 made false, and shipped
 * a dead green-panel pointer that pullone-1.0.0 had to strip at display time);
 * fm-1.2 chart FACTS (medications, problems, allergies) land after the visits
 * save via a verified capture - meds was measured EMPTY on every autopull
 * patient. The fallback now stores an exact-patient PARTIAL coverage receipt,
 * so the profile never calls a real banner capture "not pulled" and never calls
 * three banner fields a complete six-card pull; pullbar-1.0.0 a real progress
 * bar under the button, driven by the extension's own n/total encounter events.
 */
(function () {
  'use strict';
  if (window.__mlsAthenaAutoPull && window.__mlsAthenaAutoPull.installed) return;
  var VERSION = '1.2.0';
  /* A patient pull must always reach a terminal state. The cooperative store
     normally resolves this flush quickly, but a stalled writer used to leave
     the UI at "finishing the local save" forever after Athena had finished.
     Keep this bound deliberately generous for large panels while making the
     failure explicit instead of claiming a save that was never confirmed. */
  var SAVE_FLUSH_TIMEOUT_MS = 30000;
  /* A durable visit save is already terminal even when optional enrichment
     stalls. Keep the enrichment lane bounded so the single-pull control can
     be used again instead of remaining busy behind a best-effort summary or
     chart-card read. */
  var POST_SAVE_ENRICH_TIMEOUT_MS = 30000;

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

  /* A post-walk banner may contribute only three facts, so it cannot mint the
     full athenaProfileCoverage receipt. It can mint a separate partial receipt
     only when the freshly captured chart repeats the pulled patient's name and
     either DOB or stable Athena/MRN id. The receipt contains counts/statuses,
     never the clinical text itself. */
  function exactCaptureProof(captured, identity) {
    if (!captured || !identity || !namesMatch(captured.name, identity.name)) return '';
    var capturedDob = normDob(captured.dob), expectedDob = normDob(identity.dob);
    if (capturedDob && expectedDob && capturedDob === expectedDob) return 'name-dob';
    var capturedMrn = trim(captured.mrn || captured.athenaId).toLowerCase();
    var expectedMrn = trim(identity.mrn || identity.athenaId).toLowerCase();
    if (capturedMrn && expectedMrn && capturedMrn === expectedMrn) return 'name-mrn';
    return '';
  }
  function partialCoverageReceipt(patient, captured, identity, capturedAt) {
    var proof = exactCaptureProof(captured, identity);
    var pid = trim(patient && patient.id);
    if (!proof || !pid) return null;
    var fields = {};
    var meds = Array.isArray(captured.medications) ? captured.medications.map(trim).filter(Boolean) : [];
    var problems = Array.isArray(captured.problems) ? captured.problems.map(trim).filter(Boolean) : [];
    var allergies = Array.isArray(captured.allergies) ? captured.allergies.map(trim).filter(Boolean) : [];
    if (meds.length) fields.meds = { status: 'found', count: meds.length };
    if (problems.length) fields.problems = { status: 'found', count: problems.length };
    if (allergies.length) fields.allergies = { status: 'found', count: allergies.length };
    if (!Object.keys(fields).length) return null;
    return {
      kind: 'athena-partial-profile-coverage', version: '1.0.0', complete: false,
      exactIdentityVerified: true, patientId: pid,
      capturedAt: trim(capturedAt) || new Date().toISOString(),
      identityProof: proof, fields: fields
    };
  }

  /* ---------- harden the model's _normDob so the EXISTING internal gate also benefits ---------- */
  function hardenModel() {
    try {
      var m = window.__mlsVisitModel; if (!m || m._normDobHardened) return;
      m._normDobOrig = m._normDob;
      m._normDob = function (s) { var r = ''; try { r = m._normDobOrig(s); } catch (e) {} return r || normDob(s); };
      m._normDobHardened = true;
    } catch (e) {}
  }

  /* ---------- find-or-create the MLS patient FROM the chart identity ----------
     px-1.0 (2026-08-07 patient-isolation train). The old resolver bound by
     name FIRST-MATCH and accepted a name alone when either side lacked a DOB,
     then stamped the chart's DOB onto that record - so with athenaOne open on
     one "John Smith" and the store holding a different DOB-less "John Smith",
     the whole chart (visits, then history/allergies via organize) landed on
     the wrong person and the paper-over was permanent. Binding order is now:
       1) stable athena identifier (chart MRN/patient id), exact and unique,
          with a DOB conflict vetoing;
       2) name + DOB, both present, equal, exactly one candidate;
       3) otherwise CREATE a new record carrying the chart identity.
     A recoverable duplicate row is strictly safer than a wrong merge. Name
     alone never binds. */
  function resolvePatient(identity) {
    var pts = (typeof getPatients === 'function' ? getPatients() : []) || [];
    var chartMrn = trim(identity.mrn || identity.athenaId || '').toLowerCase();
    var chartDob = normDob(identity.dob);
    var found = null, via = '';
    if (chartMrn) {
      var idHits = pts.filter(function (p) {
        if (!p) return false;
        var pm = trim(p.athenaId || p.mrn || '').toLowerCase();
        if (!pm || pm !== chartMrn) return false;
        var pd = normDob(p.dob);
        if (pd && chartDob && pd !== chartDob) return false; // DOB conflict vetoes a stable-id hit
        /* px-1.5 (2026-08-08 adversarial review): a stable-id hit still needs
           the record to LOOK like the same person - a mis-stamped or typo'd
           MRN must not silently bind a differently-named chart. Name match, or
           DOB present-and-equal, corroborates; neither -> create instead. */
        return namesMatch(p.name, identity.name) || !!(pd && chartDob && pd === chartDob);
      });
      if (idHits.length === 1) { found = idHits[0]; via = 'athena-id'; }
      else if (idHits.length > 1) { found = null; via = 'athena-id-ambiguous'; }
    }
    if (!found && via !== 'athena-id-ambiguous' && chartDob) {
      var ndHits = pts.filter(function (p) {
        return p && namesMatch(p.name, identity.name) && normDob(p.dob) === chartDob;
      });
      if (ndHits.length === 1) { found = ndHits[0]; via = 'name-dob'; }
      /* dupmatch-1.0 (verified duplicate-name incident): namesMatch above is
         strict, so a missing middle initial or LAST-FIRST order minted a
         duplicate here too. Same tolerant fallback as the twins' matcher,
         gated by the SAME DOB - and only an unambiguous single hit binds;
         anything else still creates the recoverable duplicate. */
      if (!found && !ndHits.length && typeof window._athenaHistoryNameCompatible === 'function') {
        var cHits = pts.filter(function (p) {
          return p && normDob(p.dob) === chartDob && window._athenaHistoryNameCompatible(String(p.name || ''), String(identity.name || ''));
        });
        if (cHits.length === 1) { found = cHits[0]; via = 'name-dob-compat'; }
      }
    }
    if (found) {
      var changed = false;
      if (!trim(found.dob) && trim(identity.dob)) { found.dob = trim(identity.dob); changed = true; }
      var stampId = trim(identity.mrn || identity.athenaId || '');
      if (stampId && !trim(found.athenaId || '')) { found.athenaId = stampId; changed = true; }
      if (stampId && !trim(found.mrn || '')) { found.mrn = stampId; changed = true; }
      if (changed) { try { upsertPatient(found); } catch (e) {} }
      return { patient: found, created: false, via: via };
    }
    var np = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: trim(identity.name), dob: trim(identity.dob),
      mrn: trim(identity.mrn || identity.athenaId || ''), athenaId: trim(identity.mrn || identity.athenaId || ''),
      reason: '', source: 'athena-auto', created: Date.now()
    };
    try { upsertPatient(np); } catch (e) {}
    return { patient: np, created: true, via: 'created' };
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
    /* pullbar-1.0.0: the bar under the button narrates the same line; a ✓ or ⚠
       terminal message settles and then hides it. */
    try {
      if (/^✓/.test(msg)) finishBar(true, msg);
      else if (/^⚠/.test(msg)) finishBar(false, msg);
      else if (barWrap && barWrap.isConnected && barWrap.style.display !== 'none' && barText) barText.textContent = msg;
    } catch (eBs) {}
    if (loud) { try { if (typeof toast === 'function') toast(msg, /^⚠/.test(msg) ? 'err' : ''); } catch (e) {} }
  }

  /* ---------- raw result tap (rt-1.1) ----------
     The visit driver REJECTS with only the error STRING; the retry rail needs
     the structured fields (retryable, readTabId, identity.url) from the raw
     mlsAppAllVisitsResult. One tap keeps the LAST raw response - safe because
     the extension enforces a single-flight verified read. */
  var lastRawResult = null;
  var activeVisitsRequestId = '';
  var awaitingVisitsRequest = false;
  function eventRequestId(d) {
    if (!d || typeof d !== 'object') return '';
    return trim(d.requestId || d.id || (d.resp && (d.resp.requestId || d.resp.id)) || '');
  }
  function ownsActiveVisitEvent(d) {
    var id = eventRequestId(d);
    return !!(busy && activeVisitsRequestId && id && id === activeVisitsRequestId);
  }
  try {
    window.addEventListener('message', function (e) {
      try {
        var d = e.data;
        /* driveRequest creates the correlation id internally. Observe only the
           outbound request started while THIS auto-pull owns the lane, then
           accept progress/result events carrying that exact id. The old tap
           painted every successful day/background/history result into this
           bar, whose real owner could never deliver a terminal here. */
        if (d && d.source === 'mls-app' && d.type === 'mlsAppReadAllVisits' &&
          busy && awaitingVisitsRequest && !activeVisitsRequestId) {
          activeVisitsRequestId = eventRequestId(d);
          awaitingVisitsRequest = false;
          return;
        }
        if (!(d && d.source === 'mls-ext') || !ownsActiveVisitEvent(d)) return;
        if (d.type === 'mlsAppAllVisitsResult') {
          lastRawResult = e.data.resp || e.data;
          var rr = lastRawResult;
          if (rr && rr.ok === true) setBar(1, 1, 'All encounters read — verifying the local save…');
        } else if (d.type === 'mlsAppVisitsProgress') {
          var pr = d.resp || d;
          if (pr && (Number(pr.total) > 0 || pr.message)) setBar(Number(pr.n) || 0, Number(pr.total) || 0, pr.message);
        }
      } catch (e2) {}
    });
  } catch (e3) {}

  /* ---------- bounded bridge calls (cp-1.1 / rt-1.1) ---------- */
  function bridgeOnce(sendType, resultType, extra, ms) {
    return new Promise(function (resolve) {
      var done = false, t = 0;
      function cleanup() { try { window.removeEventListener('message', onR); } catch (e4) {} }
      function settle(v) { if (done) return; done = true; try { clearTimeout(t); } catch (e5) {} cleanup(); resolve(v); }
      function onR(e) {
        if (!(e.data && e.data.source === 'mls-ext' && e.data.type === resultType)) return;
        settle(e.data.resp || null);
      }
      t = setTimeout(function () { settle(null); }, ms || 9000);
      window.addEventListener('message', onR);
      var out = { source: 'mls-app', type: sendType };
      if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k]; } }
      try { window.postMessage(out, '*'); } catch (e6) { settle(null); }
    });
  }
  function captureOpen(ms) { return bridgeOnce('mlsAppCapture', 'mlsAppCaptureResult', { explicitUserPull: true, foregroundOk: true }, ms || 18000); }
  function refreshAthena(readTabId, briefingUrl, ms) {
    return bridgeOnce('mlsAppAthenaRefreshV1', 'mlsAppAthenaRefreshV1Result',
      { readTabId: Number(readTabId) || 0, briefingUrl: S(briefingUrl).slice(0, 300) }, ms || 40000);
  }
  function awaitBounded(value, ms, message) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error(message || 'Timed out'));
      }, ms);
      Promise.resolve(value).then(function (result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }, function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /* ---------- pullbar-1.0.0: a real progress bar for the single pull ----------
     Mounted INSIDE the pull door (#mlsPullDoor) when present so the door's
     button-adjacency contract stays intact; after the button otherwise. */
  var barWrap = null, barFill = null, barText = null, barHideT = 0, barLifecycle = 0;
  function cancelBarRetirement() {
    /* A terminal from pull A may still have a hide callback queued when pull B
       starts checking the open chart. Pull B has not emitted visit progress at
       that point, so setBar() cannot cancel A's callback for it. Invalidate the
       callback at the pull boundary too; the token also closes the tiny race
       where clearTimeout runs after the old callback has already been queued. */
    barLifecycle++;
    if (barHideT) { try { clearTimeout(barHideT); } catch (eB0) {} barHideT = 0; }
  }
  function ensureBar() {
    if (barWrap && barWrap.isConnected) return barWrap;
    var door = document.getElementById('mlsPullDoor');
    var btn = document.getElementById('ptPullAthenaBtn');
    var host = door || (btn && btn.parentElement ? btn.parentElement : null);
    if (!host) return null;
    barWrap = document.createElement('div');
    barWrap.id = 'mlsPullBar';
    barWrap.setAttribute('role', 'progressbar');
    barWrap.style.cssText = 'display:none;margin-top:6px;max-width:360px;';
    barWrap.innerHTML = '<div style="height:8px;border-radius:6px;background:rgba(32,64,52,.16);overflow:hidden"><div data-fill style="height:100%;width:0%;border-radius:6px;background:#2f7d5d;transition:width .35s ease"></div></div><div data-text style="font-size:12px;line-height:1.45;margin-top:3px;color:#3a5147"></div>';
    if (door) door.appendChild(barWrap);
    else if (btn && btn.nextSibling) host.insertBefore(barWrap, btn.nextSibling);
    else host.appendChild(barWrap);
    barFill = barWrap.querySelector('[data-fill]');
    barText = barWrap.querySelector('[data-text]');
    return barWrap;
  }
  /* eta-1.2 (owner: the bar must "actually tell u how long it would take"):
     the estimate comes from the MEASURED pace of this very pull - elapsed
     time over encounters finished - never a guessed constant. Before the
     first encounter lands it says the chart is being sized; the wording
     rounds honestly (minutes near the top, quarter-minutes in the middle,
     "almost done" at the tail) so it never fakes second-level precision. */
  var etaT0 = 0, etaLastN = -1;
  function etaText(n, total) {
    if (!(total > 1)) return '';
    if (!(n > 0)) { etaT0 = Date.now(); etaLastN = 0; return ' — sizing the chart…'; }
    if (n < etaLastN || !etaT0) { etaT0 = Date.now() - 1; etaLastN = 0; } /* a new pull reset */
    etaLastN = n;
    var pace = (Date.now() - etaT0) / n;
    var left = Math.max(0, Math.round(((total - n) * pace) / 1000));
    if (left <= 12) return ' — almost done';
    if (left <= 90) { var q = Math.max(15, Math.round(left / 15) * 15); return ' — about ' + q + 's left'; }
    var m = Math.max(2, Math.round(left / 30) / 2);
    return ' — about ' + (m % 1 === 0 ? m : m.toFixed(1)) + ' min left';
  }
  function setBar(n, total, msg2) {
    var w = ensureBar(); if (!w) return;
    cancelBarRetirement();
    w.style.display = 'block';
    var pct = total > 0 ? Math.max(2, Math.min(100, Math.round((Number(n) / Number(total)) * 100))) : 2;
    if (barFill) barFill.style.width = pct + '%';
    if (barText) barText.textContent = (total > 1 ? (Math.min(Number(n) || 0, total) + ' of ' + total + etaText(Number(n) || 0, Number(total)) + ' — ') : '') + S(msg2 || '');
  }
  function finishBar(okState, msg2) {
    var w = barWrap; if (!w || !w.isConnected) return;
    if (barFill && okState) barFill.style.width = '100%';
    if (barText && msg2) barText.textContent = S(msg2);
    cancelBarRetirement();
    var terminalLifecycle = barLifecycle;
    barHideT = setTimeout(function () {
      if (terminalLifecycle !== barLifecycle) return;
      barHideT = 0;
      try { w.style.display = 'none'; if (barFill) barFill.style.width = '0%'; } catch (eB2) {}
    }, okState ? 2500 : 16000); /* focus-1.1: a finished bar retires in 2.5s - 8s of full green read as "it never stops" */
  }
  /* doorbar-1.0 (owner, Ed SPEER Jr: "when I search by name and date of birth
     the loading bar doesn't come up"): the typed pull runs the CHART engine,
     whose step narration never spoke this bar's language. Export the bar so
     the chart engine's steps can drive the same surface the visits walk uses. */
  try { window.__mlsPullBar = { set: setBar, finish: finishBar }; } catch (eXp) {}

  /* ---------- the one-button auto pull ---------- */
  var busy = false;
  var activeRunLifecycle = 0;
  var BUSY_EVENT = 'mls:athena-autopull-state';
  var lastTerminalReceipt = null;
  function completeVisitReceipt(receipt, expectedRows) {
    return !!(receipt && receipt.complete === true && receipt.indexComplete === true &&
      receipt.bodyComplete === true && receipt.fullDetail === true &&
      Number(receipt.parsed) === Number(receipt.expected) &&
      Array.isArray(expectedRows) && expectedRows.length === Number(receipt.expected));
  }
  function visitAliases(row) {
    row = row || {};
    var out = [], encounter = trim(row.encounterId || row.encounterID || '').toLowerCase();
    var source = trim(row.sourceVisitKey || row.rowKey || '').toLowerCase();
    if (encounter) out.push('encounter|' + encounter);
    if (source) out.push('source|' + source);
    return out;
  }
  function aliasesIntersect(a, b) {
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) return true;
    return false;
  }
  function confirmVisitPersistence(patient, saved, model, expectedRows) {
    var pid = trim(patient && patient.id), current = null, visits = [];
    var expected = Array.isArray(expectedRows) ? expectedRows : [];
    if (!pid || Number(saved) !== expected.length) return { ok: false, reason: 'invalid-save-receipt', count: 0 };
    try {
      var rows = (typeof window.getPatients === 'function' ? window.getPatients() :
        (typeof getPatients === 'function' ? getPatients() : [])) || [];
      current = rows.filter(function (row) { return row && trim(row.id) === pid; })[0] || null;
    } catch (eRows) { current = null; }
    if (!current) return { ok: false, reason: 'patient-not-in-current-store', count: 0 };
    try { visits = model && typeof model.getVisits === 'function' ? (model.getVisits(current) || []) : (Array.isArray(current.visits) ? current.visits : []); }
    catch (eVisits) { return { ok: false, reason: 'saved-visits-not-readable', count: 0 }; }
    var normalized = [], used = Object.create(null), allExpectedAliases = [];
    try {
      if (!model || typeof model._normVisit !== 'function') throw new Error('normalizer-unavailable');
      normalized = expected.map(function (row) {
        return model._normVisit(row, 'athena-copy', {
          identityVerified: true, identityBinding: pid, bodyComplete: true
        });
      });
    } catch (eNorm) { return { ok: false, reason: 'expected-visits-not-normalizable', count: visits.length }; }
    for (var ei = 0; ei < normalized.length; ei++) {
      var wanted = normalized[ei], wantedAliases = visitAliases(wanted);
      if (!wantedAliases.length || !trim(wanted.raw)) return { ok: false, reason: 'expected-visit-proof-incomplete', count: visits.length };
      allExpectedAliases = allExpectedAliases.concat(wantedAliases);
      var matchAt = -1;
      for (var si = 0; si < visits.length; si++) {
        if (used[si]) continue;
        var stored = visits[si], storedAliases = visitAliases(stored);
        if (!aliasesIntersect(wantedAliases, storedAliases)) continue;
        if (!(stored && stored.identityVerified === true && trim(stored.identityBinding) === pid &&
          stored.fullDetail === true && stored.bodyComplete === true && stored.indexOnly !== true &&
          trim(stored.raw) === trim(wanted.raw))) continue;
        matchAt = si; break;
      }
      if (matchAt < 0) return { ok: false, reason: 'expected-visit-not-confirmed', count: visits.length };
      used[matchAt] = true;
    }
    /* A complete all-visits receipt is authoritative. Its writer reconciles
       older verified Athena rows, so an extra bound remote row means the exact
       durable set was not read back (including the expected-empty case). */
    for (var vi = 0; vi < visits.length; vi++) {
      var probe = visits[vi];
      if (!probe || !/athena|legacy|grab|pullrec|cohort/i.test(trim(probe.source)) ||
        probe.identityVerified !== true || trim(probe.identityBinding) !== pid) continue;
      if (!aliasesIntersect(visitAliases(probe), allExpectedAliases)) {
        return { ok: false, reason: 'authoritative-visit-set-not-confirmed', count: visits.length };
      }
    }
    return { ok: true, reason: 'durable-exact-set-confirmed', count: visits.length };
  }
  function emitBusy(value) {
    /* State only: never put patient identity or chart content on a DOM event. */
    try {
      var ev;
      if (typeof window.CustomEvent === 'function') ev = new CustomEvent(BUSY_EVENT, { detail: { busy: value === true } });
      else { ev = document.createEvent('CustomEvent'); ev.initCustomEvent(BUSY_EVENT, false, false, { busy: value === true }); }
      window.dispatchEvent(ev);
    } catch (e) {}
  }
  async function run(onStatus) {
    if (busy) return;
    /* Start a fresh progress lifecycle before capture/status work. Without
       this, the prior pull's terminal timer can hide this pull while it is
       still waiting for its first correlated visit-progress message. */
    cancelBarRetirement();
    var runSettled = false;
    var durableSave = null;
    function settleRun(ok, message, details) {
      details = details || {};
      runSettled = true;
      lastTerminalReceipt = {
        at: Date.now(), ok: ok === true, status: ok === true ? 'complete' : 'failed',
        requestId: activeVisitsRequestId || '', persistenceConfirmed: details.persistenceConfirmed === true,
        saved: Number(details.saved) >= 0 ? Number(details.saved) : 0,
        stored: Number(details.stored) >= 0 ? Number(details.stored) : 0,
        reason: trim(details.reason || (ok === true ? 'complete' : 'failed')).slice(0, 100)
      };
      var line = S(message || (ok === true ? 'Pull complete.' : 'Pull failed.'));
      if (!/^[✓⚠]/.test(line)) line = (ok === true ? '✓ ' : '⚠ ') + line;
      status(onStatus, line, true);
      return lastTerminalReceipt;
    }
    var cv = window.__mlsCopyVisits, M = window.__mlsVisitModel;
    if (!cv || !cv._driveRequest || !cv._saveVisits || !M) {
      settleRun(false, 'Visit modules aren’t loaded yet — reload the page and try again.', { reason: 'visit-modules-unavailable' }); hideChipLater(); emitBusy(false); return;
    }
    busy = true;
    var runLifecycle = ++activeRunLifecycle;
    activeVisitsRequestId = '';
    lastRawResult = null;
    emitBusy(true);
    try {
      hardenModel();
      /* cp-1.1: check WHO is open FIRST (a read-only capture, ~1-2s) and ask
         for what the pull needs AT THE CLICK. The old flow drove the full walk
         and complained after the fact; the owner ruled that out 2026-08-19. */
      status(onStatus, '🔍 Checking who is open in your athenaOne tab…', true);
      var pre = await captureOpen(18000);
      var preCap = (pre && pre.ok === true && pre.captured) ? pre.captured : null;
      if (!preCap || !trim(preCap.name)) {
        var door = document.getElementById('pdName');
        if (door) { try { door.focus(); door.scrollIntoView({ block: 'center' }); } catch (eDoor) {} }
        settleRun(false, 'No patient chart could be read in your athenaOne tab. Open the patient’s chart there and click again' +
          (door ? ' — or type a name and date of birth in the form under this button and MLS will find them in athena for you.' : '.') +
          ' Nothing was saved.', { reason: 'open-chart-not-readable' });
        hideChipLater(15000); return;
      }
      status(onStatus, 'Found ' + trim(preCap.name) + ' open in athenaOne — pulling their full history…', true);
      /* rt-1.1: one engine-refreshed retry. The driver rejects with only the
         error STRING; the raw tap holds the structured failure (retryable,
         readTabId, the chart's briefing URL) so a hydration-starved surface
         gets ONE fb-disciplined refresh + chart re-open (ext 3.0.74
         mlsAppAthenaRefreshV1), then ONE more read. Never loops. */
      var res = null, driveErr = '';
      for (var attempt = 0; attempt < 2; attempt++) {
        res = null; driveErr = '';
        activeVisitsRequestId = '';
        awaitingVisitsRequest = true;
        try {
          res = await cv._driveRequest('mlsAppReadAllVisits', {}, 'mlsAppAllVisitsResult',
            ['mlsAppVisitsProgress', 'mlsAppSearchProgress'],
            function (msg) { if (msg) status(onStatus, msg); }, null, 240000, 12000);
        } catch (e) { driveErr = S(e && e.message || e); }
        awaitingVisitsRequest = false;
        if (res && res.ok) break;
        var raw = lastRawResult;
        if (attempt !== 0 || !raw || raw.retryable !== true || !(Number(raw.readTabId) > 0)) break;
        status(onStatus, 'athenaOne is responding poorly — refreshing its tab and reading once more (nothing was saved yet)…', true);
        var rfr = await refreshAthena(Number(raw.readTabId), S(raw.identity && raw.identity.url || ''), 40000);
        if (!rfr || rfr.ok !== true) break;
        status(onStatus, 'athenaOne refreshed — reading the chart again…', true);
      }
      if (!res || !res.ok) {
        var em = driveErr || S(res && (res.error || res.message) || '');
        if (/frozen MLS patient|did not match/i.test(em)) {
          /* tm-1.1: this button anchors to whoever was OPEN at the click
             (detect-3072), so a mismatch mid-read means the chart CHANGED
             under the walk. Say that truth at the source. The old sentence
             blamed "a DIFFERENT patient open" — false for the empty-hint
             refusal this button used to die on — and pointed at the retired
             in-athena panel, which pullone-1.0.0 had to strip at display
             time. MLS stopped on purpose so charts can never mix. */
          settleRun(false, '⚠ The chart in athenaOne changed while it was being read, so MLS stopped — charts can never mix, and nothing was saved.', { reason: 'chart-changed-during-read' });
          hideChipLater(22000); return;
        }
        /* schedfall-1.0 (measured live 2026-08-20, Cynthia Gutierrez then Mary
           Miller - BOTH "38 encounters, 0 full clinical detail"): identical
           numbers on different patients is not patient data. The tab sat on
           the WEEK SCHEDULE while the masthead still named a patient, so the
           walker counted appointment rows as encounters and honestly bound
           zero details. When the capture carried name+DOB, fall back to the
           proven chart-first engine: it OPENS the exact chart itself and the
           visit walk then runs on that open chart (freshwalk-1.0). One hop,
           never loops; every downstream identity gate stays in force. */
        if (/only 0 had full clinical detail/i.test(em) && trim(preCap.dob) && typeof window.pullPatientChartViaAssist === 'function') {
          status(onStatus, 'That athena screen was the schedule, not ' + trim(preCap.name) + '’s chart — opening their exact chart instead…', true);
          var fbOk = false;
          try { fbOk = (await window.pullPatientChartViaAssist(null, { name: trim(preCap.name), dob: trim(preCap.dob) })) === true; } catch (eFb) {}
          if (fbOk) { settleRun(true, 'Pulled ' + trim(preCap.name) + ' through their exact chart — its own verified receipt controls the visit save.', { reason: 'exact-chart-fallback-complete', persistenceConfirmed: true }); hideChipLater(8000); return; }
          settleRun(false, 'The exact-chart fallback could not finish either. Open ' + trim(preCap.name) + '’s chart in athenaOne and click again. Nothing was saved.', { reason: 'exact-chart-fallback-failed' });
          hideChipLater(18000); return;
        }
        settleRun(false, 'Couldn’t read the open athenaOne chart (' + (em || 'no readable result') + '). Open the patient’s chart in your Athena tab, then try again. Nothing was saved.', { reason: 'visit-read-failed' });
        hideChipLater(15000); return;
      }
      var identity = res.identity || {};
      var visits = Array.isArray(res.visits) ? res.visits : [];
      if (!trim(identity.name) || !normDob(identity.dob)) {
        settleRun(false, 'Couldn’t read a clear name + DOB from the open chart — nothing was saved. Open the patient’s chart header in athenaOne and retry.', { reason: 'visit-identity-incomplete' });
        hideChipLater(); return;
      }
      var visitReceipt = res.receipt || null;
      if (!completeVisitReceipt(visitReceipt, visits)) {
        settleRun(false, 'Athena returned an encounter list without verified full detail for every row. Nothing was saved as complete history; retry with the patient chart open.', {
          reason: 'full-detail-receipt-incomplete'
        });
        hideChipLater(16000); return;
      }
      var r = resolvePatient(identity);
      var patient = r.patient;
      try { if (typeof openPatient === 'function') openPatient(patient.id); else if (typeof selectPatient === 'function') selectPatient(patient.id); } catch (e) {}
      status(onStatus, 'Found: ' + identity.name + ', DOB ' + normDob(identity.dob) + ' — pulling ' + visits.length + ' visit' + (visits.length === 1 ? '' : 's') + (r.created ? ' (new patient)' : '') + '…', true);
      var saveBatchApi = window.__mlsPatientStoreBatch, saveBatchToken = null, saved = 0;
      if (!saveBatchApi || typeof saveBatchApi.begin !== 'function' || typeof saveBatchApi.end !== 'function') {
        settleRun(false, 'The local patient-save coordinator is not ready. Reload MLS and retry; nothing is being reported as saved.', { reason: 'patient-save-coordinator-unavailable' });
        hideChipLater(16000); return;
      }
      try { saveBatchToken = saveBatchApi.begin({ cooperative: true, maxChanges: 2, maxDelayMs: 15000 }); }
      catch (eBatchBegin) {
        settleRun(false, 'MLS could not open a safe local save transaction. Nothing was saved; reload and retry.', { reason: 'patient-save-transaction-unavailable' });
        hideChipLater(16000); return;
      }
      try {
        /* Argument five is the reader's completeness receipt. Omitting it used
           to downgrade every successful row to bodyComplete:false and skip
           authoritative reconciliation — the direct cause of the misleading
           "visit notes incomplete" result after this button finished. */
        saved = cv._saveVisits(patient, identity, visits, function (msg) { if (msg) status(onStatus, msg); }, visitReceipt);
      } catch (e) {
        try { await Promise.resolve(saveBatchApi.end(saveBatchToken, 'athena-autopull-visit-save-rejected')); } catch (eBatchAbort) {}
        settleRun(false, (e && e.message || 'Save failed') + '.', { reason: 'visit-save-rejected' }); hideChipLater(); return;
      }
      status(onStatus, 'Encounter details verified — finishing the local save…');
      try {
        await awaitBounded(saveBatchApi.end(saveBatchToken, 'athena-autopull-visit-save'), SAVE_FLUSH_TIMEOUT_MS,
          'The local patient save did not respond before the safety timeout');
      }
      catch (eBatchEnd) {
        settleRun(false, 'The encounter read finished, but the local save did not become durable or respond in time. Nothing is being reported as saved; reload and retry.', {
          reason: 'patient-save-flush-failed', saved: saved
        });
        hideChipLater(16000); return;
      }
      var persisted = confirmVisitPersistence(patient, saved, M, visits);
      if (!persisted.ok) {
        settleRun(false, 'The encounter read finished, but MLS could not confirm the exact saved visits. Nothing is being reported as saved; reload and retry.', {
          reason: persisted.reason, saved: saved, stored: persisted.count
        });
        hideChipLater(16000); return;
      }
      durableSave = { saved: Number(saved) || 0, stored: Number(persisted.count) || 0 };
      /* Persistence is proven, but the owned pull is not terminal until the two
         bounded enrichments below settle. Do not show a green terminal receipt
         while `busy` is still true: that made the UI promise a retry the lane
         could not yet accept. Run summary + chart-card reads concurrently so
         the post-save phase costs one timeout window, not two. */
      status(onStatus, 'Visits saved locally (' + persisted.count + ' now on file). Finishing summaries and chart details…');
      /* first-pull-style-1.0.0: persist a short account-local completion receipt
         before emitting the public seam. The event itself carries only a count,
         so unrelated listeners cannot observe a patient identity; a late-loaded
         style module replays the receipt and reads only verified local rows. */
      try {
        var firstPullPendingKey = typeof window.uns === 'function'
          ? window.uns('firstPullStylePendingV1') : 'firstPullStylePendingV1';
        window.localStorage.setItem(firstPullPendingKey, JSON.stringify({
          patientId: String(patient.id || ''), saved: Number(saved) || 0, at: Date.now()
        }));
        var firstPullEvent = typeof window.CustomEvent === 'function'
          ? new CustomEvent('mls:athena-full-history-pull-complete', { detail: { saved: Number(saved) || 0 } })
          : null;
        if (firstPullEvent) window.dispatchEvent(firstPullEvent);
      } catch (eFirstPullStyle) {}
      function enrichmentStatus(msg) {
        if (msg && busy && runLifecycle === activeRunLifecycle && !runSettled) status(onStatus, msg);
      }
      var summaryOpen = true;
      var summaryTask = (async function () {
        try {
          await awaitBounded(M.ensureSummaries(patient.id, function (msg) { if (summaryOpen) enrichmentStatus(msg); }),
            POST_SAVE_ENRICH_TIMEOUT_MS, 'Visit summaries did not respond before the safety timeout');
          return true;
        } catch (eSummary) {
          enrichmentStatus('Visits are saved. Visit summaries did not finish in time; continuing with the remaining chart details.');
          return false;
        } finally { summaryOpen = false; }
      })();
      /* ff-1.2 (owner, live Alicia James card 2026-08-19: every prep-summary
         line read "NOT PULLED from Athena yet" after a one-person pull - "it
         needs to also pull their actual history and stuff not just their
         visits"): the visits verb never carried the chart CARD. The app's own
         __mlsChartField.read is the proven rail - verified read, parse, and a
         three-factor-gated save of problems, medications, allergies, summary,
         VITALS and HISTORY plus the provenance stamp the SOURCE line reads.
         The chart is already open and verified from the walk, so this read
         lands fast. PROVE the handle exists before trusting it (a
         feature-detect must never hide a typo); the capture merge below stays
         as the fallback when the rail is absent or refuses. */
      var cardOpen = true;
      var cardTask = (async function () {
        try {
          var cf = window.__mlsChartField;
          if (!(cf && typeof cf.read === 'function')) return false;
          enrichmentStatus('Reading the full chart card — medications, vitals, history…');
          var cardRes = await awaitBounded(Promise.resolve(cf.read(patient, function (msg) { if (cardOpen) enrichmentStatus(msg); })),
            POST_SAVE_ENRICH_TIMEOUT_MS, 'The full chart card did not respond before the safety timeout');
          var landed = !!(cardRes && cardRes.ok === true);
          if (!landed && cardRes && cardRes.reason) {
            enrichmentStatus('The full chart card could not be read (' + S(cardRes.reason) + ') — visits are saved; the card can be pulled from the profile.');
          }
          return landed;
        } catch (eFf) {
          enrichmentStatus('Visits are saved. The full chart card did not finish in time; continuing with the verified visit history.');
          return false;
        } finally { cardOpen = false; }
      })();
      var enrichmentResults = await Promise.all([summaryTask, cardTask]);
      var cardLanded = enrichmentResults[1] === true;
      /* fm-1.2 fallback: a verified capture still lands medications/problems/
         allergies off the open chart banner when the full-card rail is absent
         or refused. A same-name capture is not enough: DOB or MRN must also
         match, and the partial receipt prevents the profile from claiming
         either "not pulled" or a complete six-card pull. */
      if (!cardLanded) try {
        var post = await captureOpen(18000);
        var postCap = (post && post.ok === true && post.captured) ? post.captured : null;
        var partialReceipt = partialCoverageReceipt(patient, postCap, identity);
        if (partialReceipt) {
          var medsIn = Array.isArray(postCap.medications) ? postCap.medications.map(trim).filter(Boolean) : [];
          if (medsIn.length) {
            var haveMeds = S(patient.meds);
            var addMeds = medsIn.filter(function (m) { return haveMeds.toLowerCase().indexOf(m.toLowerCase()) < 0; });
            if (addMeds.length) patient.meds = (trim(haveMeds) ? trim(haveMeds) + '\n' : '') + addMeds.join('\n');
          }
          if (!trim(patient.problems) && Array.isArray(postCap.problems) && postCap.problems.length) {
            patient.problems = postCap.problems.map(trim).filter(Boolean).join('\n');
          }
          if (!trim(patient.allergies) && Array.isArray(postCap.allergies) && postCap.allergies.length) {
            patient.allergies = postCap.allergies.map(trim).filter(Boolean).join('\n');
          }
          /* Save the receipt even when every captured fact was already present;
             provenance changed even if the display characters did not. */
          patient.athenaPartialProfileCoverage = partialReceipt;
          try { upsertPatient(patient); } catch (eFm1) {}
          status(onStatus, 'Partial chart facts saved with an identity-verified receipt — re-pull the full chart for vitals and history.');
        } else if (postCap && namesMatch(postCap.name, identity.name)) {
          status(onStatus, 'The banner capture did not repeat this patient’s DOB or Athena ID, so MLS saved no chart facts from it.');
        }
      } catch (eFm) {}
      try { window.__mlsVisitUI && window.__mlsVisitUI.render && window.__mlsVisitUI.render(true); } catch (e) {}
      try { if (typeof renderProfile === 'function') renderProfile(); } catch (e) {}
      var n = persisted.count;
      try {
        var currentRows = (typeof window.getPatients === 'function' ? window.getPatients() : []) || [];
        var currentPatient = currentRows.filter(function (row) { return row && trim(row.id) === trim(patient.id); })[0] || patient;
        n = M.getVisits(currentPatient).length;
      } catch (e) {}
      /* the terminal line reports what THIS pull captured — the total the
         patient already had is context, never the headline (finding #6). */
      settleRun(true, 'Done — ' + saved + ' new visit' + (saved === 1 ? '' : 's') + ' captured for ' + identity.name + ' (' + n + ' now on file).', {
        reason: 'complete', persistenceConfirmed: true, saved: saved, stored: n
      });
      /* focus-1.1 (owner, 2026-08-20: "it should pull up whoever it just saved"
         and "it still doesn't stop when it's done"): the terminal state OWNS
         the screen. The early openPatient() at resolve time selects but does
         not SWITCH VIEW or survive a mid-pull deselect, so the doctor could
         finish a pull staring at a different room. Land the saved patient's
         card wherever the pull started, and retire the progress surfaces
         quickly instead of letting a full bar linger like unfinished work. */
      try { if (typeof setActivePtId === 'function') setActivePtId(String(patient.id)); } catch (eF1) {}
      try { if (typeof showView === 'function') showView('patients'); } catch (eF2) {}
      try { if (typeof renderPatients === 'function') renderPatients(); if (typeof renderProfile === 'function') renderProfile(); } catch (eF3) {}
      try { var pcF = document.getElementById('profileCard'); if (pcF && pcF.scrollIntoView) pcF.scrollIntoView({ block: 'nearest' }); } catch (eF4) {}
      hideChipLater(5000);
      return { ok: true, saved: saved, total: n, created: r.created, receipt: lastTerminalReceipt };
    } catch (unexpected) {
      if (!runSettled && durableSave) {
        settleRun(true, 'The verified visits are saved. Optional summaries or chart details stopped early and can be refreshed later.', {
          reason: 'saved-enrichment-ended-early', persistenceConfirmed: true, saved: durableSave.saved, stored: durableSave.stored
        });
      } else if (!runSettled) {
        settleRun(false, 'The pull stopped before MLS could confirm a local save. Nothing is being reported as saved; retry with the patient chart open.', { reason: 'unexpected-pull-exit' });
      }
      hideChipLater(durableSave ? 5000 : 16000);
      return { ok: !!durableSave, saved: durableSave && durableSave.saved || 0, reason: durableSave ? 'saved-enrichment-ended-early' : 'unexpected-pull-exit', receipt: lastTerminalReceipt };
    } finally {
      if (!runSettled && durableSave) {
        settleRun(true, 'The verified visits are saved. Optional summaries or chart details ended without a final receipt and can be refreshed later.', {
          reason: 'saved-enrichment-receipt-missing', persistenceConfirmed: true, saved: durableSave.saved, stored: durableSave.stored
        });
      } else if (!runSettled) {
        settleRun(false, 'The pull ended without a confirmed local save receipt. Nothing is being reported as saved; retry with the patient chart open.', { reason: 'terminal-receipt-missing' });
      }
      busy = false;
      activeVisitsRequestId = '';
      awaitingVisitsRequest = false;
      emitBusy(false);
    }
  }

  /* ---------- wire the existing "📥 Pull from Athena" button to the no-typing auto flow ---------- */
  function install() {
    hardenModel();
    if (typeof window.pullPatientFromAthenaPrompt === 'function' && !window.pullPatientFromAthenaPrompt.__mlsAutoWrapped) {
      window.__mlsPullPromptOrig = window.pullPatientFromAthenaPrompt; // keep the typed-search fallback available
      /* Return the real completion Promise. Besides making callers testable,
         this lets every browser (including timer-throttled background tabs on
         macOS) bind UI completion to the actual read instead of a timeout. */
      var wrapped = function (btn) { return run(null); };
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
    isBusy: function () { return busy; }, busyEvent: BUSY_EVENT,
    resolvePatient: resolvePatient, namesMatch: namesMatch, normDob: normDob, dobsMatch: dobsMatch,
    exactCaptureProof: exactCaptureProof, partialCoverageReceipt: partialCoverageReceipt,
    firstLast: firstLast, hardenModel: hardenModel, revert: revert,
    terminalReceipt: function () { return lastTerminalReceipt; },
    _confirmVisitPersistence: confirmVisitPersistence,
    _eventRequestId: eventRequestId
  };
})();
