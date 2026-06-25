/* ============================================================================
 * feat_mls_chartautofill.js  ->  window.__mlsChartFill   (cf-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 6: when Michael is on a patient's chart in athenaOne, auto-fill that
 * patient's first + last name (and DOB when present) into the active visit.
 *
 * READ-ONLY: uses the extension's existing mlsAppReadChart bridge with an EMPTY
 * patient argument, so the extension does NOT click or search anything -- it
 * only reads the innerText of the already-open Athena tab. No chart writes, no
 * sign, no save. (If a future extension returns a structured resp.patientName /
 * resp.dob from the patient banner, this module uses that directly.)
 *
 * SAFETY (live clinical app): never silently trusts a guess for a high-stakes
 * field. It fills the editable hero name/DOB and shows the detected name in a
 * toast so the doctor verifies it; it never auto-submits, signs, or saves.
 *
 * Trigger: a "From open Athena chart" button next to the visit hero name field,
 * AND one gentle auto-attempt when the Visit view opens with an empty name.
 *
 * Additive, idempotent, reversible (window.__mlsChartFill.revert()), ASCII-only.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsChartFill && window.__mlsChartFill.installed) return; } catch (e) { return; }

  var VERSION = 'cf-1.0.0';
  var autoTriedForLoad = false;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function toast(m, k) { safe(function () { if (typeof window.toast === 'function') window.toast(m, k || ''); }); }

  /* ===================== NAME / DOB PARSER ===================== */
  // Tokens that are NOT a patient name (athenaOne chrome, the signed-in provider, menus)
  var STOP = /(log ?out|patient actions|registration|messaging|scheduling|billing|clinicals|communicator|quickview|athenanet|athenahealth|dashboard|calendar|claims|financials|reports|quality|support|mschaeffer|provider|sign ?in|menu|search|home)/i;

  // Single-word noise tokens that must never be treated as part of a patient name.
  var NOISE = {};
  ('patient summary vitals vital problem problems encounter date active allergy allergies medication '
    + 'medications meds history insurance chart note notes visit dob name sex gender male female age years '
    + 'year deceased address phone email provider pcp mrn id status results result lab labs imaging surgery '
    + 'surgical plan assessment diagnosis diagnoses immunization immunizations registration billing scheduling '
    + 'messaging clinicals communicator quickview dashboard calendar patients claims financials reports quality '
    + 'support home menu search list view all of the and or new edit print form forms label labels eligibility '
    + 'walkin appointment appointments balance copay payments ledger contact emergency').split(/\s+/)
    .forEach(function (w) { NOISE[w] = 1; });

  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/\b([a-z])/g, function (m, c) { return c.toUpperCase(); });
  }
  function cleanName(s) {
    return String(s || '').replace(/\s+/g, ' ').replace(/[^A-Za-z'\-\s,]/g, '').trim();
  }
  function nameTok(w) {
    // a plausible name token: letters/hyphen/apostrophe, 1-20 chars, NOT a noise word
    if (!/^[A-Za-z][A-Za-z'\-]{0,19}$/.test(w)) return false;
    if (NOISE[w.toLowerCase()]) return false;
    return true;
  }
  function isNamey(s) {
    if (!s) return false;
    if (STOP.test(s)) return false;
    var words = s.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) return false;
    return words.every(nameTok);
  }
  // "Last, First M" -> "First Last"
  function flipLastFirst(s) {
    var m = String(s).match(/^\s*([A-Za-z'\-]+)\s*,\s*([A-Za-z'\-]+)(?:\s+([A-Za-z'\-]+))?\s*$/);
    if (!m) return null;
    var last = m[1], first = m[2];
    return titleCase(first + ' ' + last);
  }

  // Parse a {name, dob} from raw athenaOne chart text. Conservative: only returns
  // a name when it co-occurs with a DOB date or an age/sex banner token nearby.
  function parseIdentity(text) {
    var t = String(text || '');
    if (!t) return null;
    var YEAR = '(?:18|19|20)\\d\\d';
    var dateRe = new RegExp('([01]?\\d)[\\/\\-]([0-3]?\\d)[\\/\\-](' + YEAR + ')', 'g');
    var best = null;

    // Pass 1: a date that is labeled DOB/Date of Birth, with a name within ~90 chars before it
    var dobLabel = new RegExp('(D\\.?O\\.?B\\.?|Date of Birth)\\s*:?\\s*([01]?\\d[\\/\\-][0-3]?\\d[\\/\\-]' + YEAR + ')', 'ig');
    var m;
    while ((m = dobLabel.exec(t))) {
      var dob = normDate(m[2]);
      // names appear BEFORE the DOB in the banner; do not parse the text that follows it
      var before = t.slice(Math.max(0, m.index - 90), m.index);
      var nm = nameFromContext(before);
      if (nm) { best = { name: nm, dob: dob, conf: 'dob-label' }; break; }
    }
    if (best) return best;

    // Pass 2: any birth-year date with a "Last, First" or banner name immediately before,
    // and an age/sex token nearby (yo / y.o. / Male / Female) to reduce false positives.
    dateRe.lastIndex = 0;
    while ((m = dateRe.exec(t))) {
      var around = t.slice(Math.max(0, m.index - 90), m.index + 60);
      if (!/(\byo\b|y\.?o\.?|\bmale\b|\bfemale\b|\bage\b|\bsex\b|\bgender\b)/i.test(around)) continue;
      var nm2 = nameFromContext(t.slice(Math.max(0, m.index - 90), m.index));
      if (nm2) { best = { name: nm2, dob: normDate(m[0]), conf: 'date+banner' }; break; }
    }
    if (best) return best;

    // Pass 3: an explicit "Patient:" / "Patient Name:" label
    var pm = t.match(/Patient(?:\s*Name)?\s*:?\s*([A-Za-z'\-]+\s*,\s*[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+)?|[A-Za-z'\-]+\s+[A-Za-z'\-]+)/i);
    if (pm) {
      var cand = pm[1];
      var flipped = flipLastFirst(cand);
      var nm3 = flipped || (isNamey(cleanName(cand)) ? titleCase(cleanName(cand)) : null);
      if (nm3 && !STOP.test(nm3)) return { name: nm3, dob: '', conf: 'patient-label' };
    }
    return null;
  }

  // Extract the most plausible name from a short text fragment (prefers "Last, First").
  function nameFromContext(frag) {
    var f = cleanName(frag);
    if (!f) return null;
    // prefer the LAST "Last, First" occurrence in the fragment (closest to the date)
    var lf = f.match(/[A-Za-z'\-]+\s*,\s*[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+)?/g);
    if (lf && lf.length) {
      for (var i = lf.length - 1; i >= 0; i--) {
        var pieces = lf[i].split(/\s*,\s*/);
        if (pieces.length === 2 && nameTok(pieces[0]) && pieces[1].split(/\s+/).every(nameTok)) {
          var flipped = flipLastFirst(lf[i]);
          if (flipped && !STOP.test(flipped)) return flipped;
        }
      }
    }
    // else: tokenize and find the LAST maximal run of consecutive name tokens (drops
    // noise words like "Patient", "Summary", "DOB"); take up to the last 2-3 of that run.
    var toks = f.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    var runs = [], cur = [];
    toks.forEach(function (w) {
      if (nameTok(w)) cur.push(w);
      else { if (cur.length) runs.push(cur); cur = []; }
    });
    if (cur.length) runs.push(cur);
    for (var j = runs.length - 1; j >= 0; j--) {
      var run = runs[j];
      if (run.length < 2) continue;
      var pick = run.slice(-3); // First [Middle] Last at most
      if (pick.length > 2 && pick[1].length > 2) pick = [pick[0], pick[pick.length - 1]]; // drop a non-initial middle
      return titleCase(pick.join(' '));
    }
    return null;
  }

  function normDate(s) {
    var m = String(s || '').match(/([01]?\d)[\/\-]([0-3]?\d)[\/\-]((?:18|19|20)\d\d)/);
    if (!m) return '';
    var mm = ('0' + m[1]).slice(-2), dd = ('0' + m[2]).slice(-2);
    return mm + '/' + dd + '/' + m[3];
  }

  /* ===================== READ-ONLY CHART READ ===================== */
  // Posts mlsAppReadChart with an EMPTY patient -> pure read of the open tab.
  function readOpenChart(timeoutMs) {
    return new Promise(function (resolve) {
      var done = false, ponged = false, tries = 0, iv = null;
      function onPong(e) {
        if (e.data && e.data.source === 'mls-ext' && e.data.type === 'mlsPong' && !ponged) {
          ponged = true; if (iv) clearInterval(iv);
          window.removeEventListener('message', onPong);
          window.addEventListener('message', onResult);
          try { window.postMessage({ source: 'mls-app', type: 'mlsAppReadChart', patient: '' }, '*'); } catch (e2) {}
        }
      }
      function onResult(e) {
        if (!(e.data && e.data.source === 'mls-ext' && e.data.type === 'mlsAppChartResult')) return;
        done = true; window.removeEventListener('message', onResult);
        resolve(e.data.resp || {});
      }
      window.addEventListener('message', onPong);
      var ping = function () { try { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); } catch (e3) {} };
      ping();
      iv = setInterval(function () {
        tries++;
        if (ponged) { clearInterval(iv); return; }
        if (tries > 8) { clearInterval(iv); window.removeEventListener('message', onPong); if (!done) resolve({ error: 'no-extension' }); }
        else ping();
      }, 350);
      setTimeout(function () {
        if (!done) { window.removeEventListener('message', onPong); window.removeEventListener('message', onResult); resolve({ error: 'timeout' }); }
      }, timeoutMs || 14000);
    });
  }

  function redact(name) {
    // for logs/verification we never need the full PHI; keep the displayed toast full
    // (the doctor must see it to verify) but expose a redacted form via the API.
    return String(name || '').split(/\s+/).map(function (w) { return w ? w[0] + '***' : ''; }).join(' ');
  }

  /* ===================== FILL ===================== */
  function fillInto(name, dob) {
    var filled = {};
    var n = gid('heroPtName');
    if (n) {
      n.value = name;
      n.dispatchEvent(new Event('input', { bubbles: true }));
      n.dispatchEvent(new Event('change', { bubbles: true }));
      filled.hero = true;
    }
    var d = gid('heroPtDob');
    if (d && dob) {
      d.value = dob;
      d.dispatchEvent(new Event('input', { bubbles: true }));
      d.dispatchEvent(new Event('change', { bubbles: true }));
      filled.dob = true;
    }
    var pl = gid('patientLabel');
    if (pl) { pl.value = name; filled.label = true; }
    // link an existing MLS patient by exact name so the note attaches correctly
    safe(function () {
      if (typeof getPatients === 'function' && typeof selectPatient === 'function') {
        var p = getPatients().find(function (x) { return String(x.name || '').trim().toLowerCase() === name.toLowerCase(); });
        if (p) { selectPatient(p.id); filled.linked = true; }
      }
    });
    return filled;
  }

  // Main entry: read the open chart and fill. quiet=true suppresses "nothing found" toasts (auto mode).
  function pull(quiet) {
    return readOpenChart(14000).then(function (resp) {
      if (!resp || resp.error || resp.ok === false) {
        var why = resp && resp.error;
        if (!quiet) {
          if (why === 'no-extension') toast('MLS Assist not detected. Install/enable it and open the patient chart in athenaOne.', 'err');
          else if (why === 'timeout') toast('Could not read your athenaOne tab in time. Open the patient chart and try again.', 'err');
          else toast((resp && resp.error) || 'Could not read the open athenaOne chart.', 'err');
        }
        return { ok: false, reason: why || 'read-failed' };
      }
      // prefer a structured banner from a newer extension, else parse the text
      var id = null;
      if (resp.patientName && isNamey(cleanName(resp.patientName))) {
        id = { name: flipLastFirst(resp.patientName) || titleCase(cleanName(resp.patientName)), dob: normDate(resp.dob || ''), conf: 'ext-banner' };
      }
      if (!id) id = parseIdentity(resp.text || '');
      if (!id || !id.name) {
        if (!quiet) toast('No patient name found on the open chart. Make sure a patient chart (not the dashboard) is open in athenaOne.', '');
        return { ok: false, reason: 'no-name' };
      }
      var filled = fillInto(id.name, id.dob);
      toast('Filled "' + id.name + '"' + (id.dob ? ' (DOB ' + id.dob + ')' : '') + ' from your open athenaOne chart - please verify it is the right patient.', 'ok');
      return { ok: true, name: id.name, dob: id.dob, conf: id.conf, filled: filled };
    });
  }

  /* ===================== UI BUTTON ===================== */
  function ensureButton() {
    var name = gid('heroPtName');
    if (!name) return;
    if (gid('mlsChartFillBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'mlsChartFillBtn';
    btn.type = 'button';
    btn.textContent = 'From open Athena chart';
    btn.title = 'Read the patient currently open in your athenaOne tab (read-only) and fill their name here';
    btn.style.cssText = 'margin:6px 0 0;display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.35);'
      + 'background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:6px 11px;font:600 12.5px/1 system-ui,sans-serif;cursor:pointer';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      btn.disabled = true; var old = btn.textContent; btn.textContent = 'Reading chart...';
      pull(false).then(function () { btn.disabled = false; btn.textContent = old; });
    });
    // place it right after the hero name input (or its wrapper)
    var anchor = name.parentNode || name;
    if (name.nextSibling) anchor.insertBefore(btn, name.nextSibling);
    else anchor.appendChild(btn);
  }

  /* ===================== AUTO-ATTEMPT (gentle, once per load) ===================== */
  function maybeAuto() {
    if (autoTriedForLoad) return;
    // only on the visit view, only when the name field is empty
    var vv = gid('visitView');
    if (!vv || vv.style.display === 'none' || vv.offsetParent === null) return;
    var n = gid('heroPtName');
    if (!n) return;
    if (String(n.value || '').trim()) return; // already has a patient -> don't override
    autoTriedForLoad = true;
    pull(true).then(function (r) { /* silent on failure */ });
  }

  /* ===================== BOOT ===================== */
  var tickT = 0;
  function tick() { ensureButton(); maybeAuto(); }
  function boot() {
    ensureButton();
    tickT = setInterval(tick, 1500);
  }

  function revert() {
    safe(function () { clearInterval(tickT); });
    safe(function () { var b = gid('mlsChartFillBtn'); if (b && b.parentNode) b.parentNode.removeChild(b); });
    safe(function () { window.__mlsChartFill.installed = false; });
  }

  window.__mlsChartFill = {
    installed: true,
    version: VERSION,
    pull: pull,
    readOpenChart: readOpenChart,
    parseIdentity: parseIdentity,
    flipLastFirst: flipLastFirst,
    redact: redact,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
