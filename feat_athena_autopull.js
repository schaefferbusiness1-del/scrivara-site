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
 * fm-1.1 chart FACTS (medications, problems, allergies) land after the visits
 * save via a verified capture - meds was measured EMPTY on every autopull
 * patient; pullbar-1.0.0 a real progress bar under the button, driven by the
 * extension's own n/total encounter progress events.
 */
(function () {
  'use strict';
  if (window.__mlsAthenaAutoPull && window.__mlsAthenaAutoPull.installed) return;
  var VERSION = '1.1.0';

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
  try {
    window.addEventListener('message', function (e) {
      try {
        if (!(e.data && e.data.source === 'mls-ext')) return;
        if (e.data.type === 'mlsAppAllVisitsResult') {
          lastRawResult = e.data.resp || e.data;
          var rr = lastRawResult;
          if (rr && rr.ok === true) setBar(1, 1, 'All encounters read — saving…');
        } else if (e.data.type === 'mlsAppVisitsProgress') {
          var pr = e.data.resp || e.data;
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
  function captureOpen(ms) { return bridgeOnce('mlsAppCapture', 'mlsAppCaptureResult', null, ms || 9000); }
  function refreshAthena(readTabId, briefingUrl, ms) {
    return bridgeOnce('mlsAppAthenaRefreshV1', 'mlsAppAthenaRefreshV1Result',
      { readTabId: Number(readTabId) || 0, briefingUrl: S(briefingUrl).slice(0, 300) }, ms || 40000);
  }

  /* ---------- pullbar-1.0.0: a real progress bar for the single pull ----------
     Mounted INSIDE the pull door (#mlsPullDoor) when present so the door's
     button-adjacency contract stays intact; after the button otherwise. */
  var barWrap = null, barFill = null, barText = null, barHideT = 0;
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
  function setBar(n, total, msg2) {
    var w = ensureBar(); if (!w) return;
    if (barHideT) { try { clearTimeout(barHideT); } catch (eB0) {} barHideT = 0; }
    w.style.display = 'block';
    var pct = total > 0 ? Math.max(2, Math.min(100, Math.round((Number(n) / Number(total)) * 100))) : 2;
    if (barFill) barFill.style.width = pct + '%';
    if (barText) barText.textContent = (total > 1 ? (Math.min(Number(n) || 0, total) + ' of ' + total + ' — ') : '') + S(msg2 || '');
  }
  function finishBar(okState, msg2) {
    var w = barWrap; if (!w || !w.isConnected) return;
    if (barFill && okState) barFill.style.width = '100%';
    if (barText && msg2) barText.textContent = S(msg2);
    if (barHideT) { try { clearTimeout(barHideT); } catch (eB1) {} }
    barHideT = setTimeout(function () { try { w.style.display = 'none'; if (barFill) barFill.style.width = '0%'; } catch (eB2) {} }, okState ? 8000 : 16000);
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
      /* cp-1.1: check WHO is open FIRST (a read-only capture, ~1-2s) and ask
         for what the pull needs AT THE CLICK. The old flow drove the full walk
         and complained after the fact; the owner ruled that out 2026-08-19. */
      status(onStatus, '🔍 Checking who is open in your athenaOne tab…', true);
      var pre = await captureOpen(9000);
      var preCap = (pre && pre.ok === true && pre.captured) ? pre.captured : null;
      if (!preCap || !trim(preCap.name)) {
        var door = document.getElementById('pdName');
        if (door) { try { door.focus(); door.scrollIntoView({ block: 'center' }); } catch (eDoor) {} }
        status(onStatus, '⚠ No patient chart could be read in your athenaOne tab. Open the patient’s chart there and click again' +
          (door ? ' — or type a name and date of birth in the form under this button and MLS will find them in athena for you.' : '.') +
          ' Nothing was saved.', true);
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
        try {
          res = await cv._driveRequest('mlsAppReadAllVisits', {}, 'mlsAppAllVisitsResult',
            ['mlsAppVisitsProgress', 'mlsAppSearchProgress'],
            function (msg) { if (msg) status(onStatus, msg); }, null, 240000, 12000);
        } catch (e) { driveErr = S(e && e.message || e); }
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
          status(onStatus, '⚠ The chart in athenaOne changed while it was being read, so MLS stopped — charts can never mix, and nothing was saved. Keep one patient’s chart open in athenaOne and click again.', true);
          hideChipLater(22000); return;
        }
        status(onStatus, '⚠ Couldn’t read the open athenaOne chart (' + (em || 'no readable result') + '). Open the patient’s chart in your Athena tab, then try again. Nothing was saved.', true);
        hideChipLater(15000); return;
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
      /* fm-1.1: land the chart FACTS the visits verb never carries. A verified
         capture reads medications/problems/allergies straight off the open
         chart banner cards; meds was measured EMPTY on every autopull patient
         (2026-08-19, Tom + Lamar) while the capture reply carried them. Names
         must still match the pulled identity - a swapped chart adds nothing. */
      try {
        var post = await captureOpen(9000);
        var postCap = (post && post.ok === true && post.captured) ? post.captured : null;
        if (postCap && namesMatch(postCap.name, identity.name)) {
          var factsChanged = false;
          var medsIn = Array.isArray(postCap.medications) ? postCap.medications.map(trim).filter(Boolean) : [];
          if (medsIn.length) {
            var haveMeds = S(patient.meds);
            var addMeds = medsIn.filter(function (m) { return haveMeds.toLowerCase().indexOf(m.toLowerCase()) < 0; });
            if (addMeds.length) { patient.meds = (trim(haveMeds) ? trim(haveMeds) + '\n' : '') + addMeds.join('\n'); factsChanged = true; }
          }
          if (!trim(patient.problems) && Array.isArray(postCap.problems) && postCap.problems.length) {
            patient.problems = postCap.problems.map(trim).filter(Boolean).join('\n'); factsChanged = true;
          }
          if (!trim(patient.allergies) && Array.isArray(postCap.allergies) && postCap.allergies.length) {
            patient.allergies = postCap.allergies.map(trim).filter(Boolean).join('\n'); factsChanged = true;
          }
          if (factsChanged) {
            try { upsertPatient(patient); } catch (eFm1) {}
            status(onStatus, 'Chart facts saved — medications, problems and allergies are on the profile.');
          }
        }
      } catch (eFm) {}
      try { window.__mlsVisitUI && window.__mlsVisitUI.render && window.__mlsVisitUI.render(true); } catch (e) {}
      try { if (typeof renderProfile === 'function') renderProfile(); } catch (e) {}
      var n = saved; try { n = M.getVisits(patient).length; } catch (e) {}
      /* the terminal line reports what THIS pull captured — the total the
         patient already had is context, never the headline (finding #6). */
      status(onStatus, '✓ Done — ' + saved + ' new visit' + (saved === 1 ? '' : 's') + ' captured for ' + identity.name + ' (' + n + ' now on file).', true);
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
