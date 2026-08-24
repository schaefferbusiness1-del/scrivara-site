/* MLS first-pull style bootstrap
 *
 * A full Athena history pull is a useful, clinician-requested source of
 * writing structure.  This module turns only the shape of a few verified
 * prior notes into the account's initial HPI/ROS/Exam/Assessment/Plan saved
 * formats. It never stores or transmits example notes or patient facts, and it
 * never transmits an identifier. A short account-local receipt may retain the
 * app's existing patient row key until this module handles it. The full note is
 * inspected only in memory; a structural
 * skeleton made exclusively from generic labels/placeholders is all that can
 * reach account settings. Existing clinician formats always win.
 */
(function (root) {
  'use strict';
  var VERSION = 'first-pull-style-1.1.0';
  if (!root) return;
  var priorApi = root.__mlsFirstPullStyle;
  if (priorApi && priorApi.installed === true && priorApi.version === VERSION && typeof priorApi.bootstrap === 'function') return;
  var MARKER = 'firstPullStyleBootstrapV1';
  var PENDING = 'firstPullStylePendingV1';
  var LOCK = 'firstPullStyleBootstrapLockV1';
  var FAMILIES = ['hpi', 'ros', 'exam', 'assessment', 'plan'];
  var MAX_VISITS = 4;
  var HEADING = {
    hpi: ['HPI', 'HISTORY OF PRESENT ILLNESS'],
    ros: ['ROS', 'REVIEW OF SYSTEMS'],
    exam: ['EXAM', 'PHYSICAL EXAM', 'EXAMINATION'],
    assessment: ['ASSESSMENT'],
    plan: ['PLAN', 'PLAN / FOLLOW-UP', 'FOLLOW-UP']
  };
  var ORDER = ['HPI', 'ROS', 'EXAM', 'PHYSICAL EXAM', 'EXAMINATION', 'ASSESSMENT', 'PLAN', 'PLAN / FOLLOW-UP', 'FOLLOW-UP'];
  var GENERIC_STRUCTURE_WORDS = {};
  ('hpi history interval chief complaint concern presenting onset location laterality duration character severity timing context modifying factors associated symptom symptoms functional impact prior treatment response medication medications allergy allergies ros review system systems constitutional musculoskeletal neurologic cardiovascular respiratory gastrointestinal genitourinary skin psychiatric endocrine hematologic exam physical examination vital vitals general gait inspection palpation range motion strength sensation reflex reflexes special test tests assessment impression diagnosis differential status evidence plan follow up therapy imaging procedure procedures referral referrals order orders counseling precaution precautions restriction restrictions monitoring disposition next step steps action actions item items addressed body case clinical current date documented documentation field fields finding findings format heading headings include instruction instructions label labels missing narrative paragraph negative positive not note notes objective only placeholder problem problems provider section source template time use value values patient visit visits applicable unknown supported detail details content'.split(' ')).forEach(function (word) { GENERIC_STRUCTURE_WORDS[word] = true; });

  function clean(v, n) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim().slice(0, n || 2000).trim();
  }
  function sectionBlock(raw, family) {
    raw = clean(raw, 120000); if (!raw) return '';
    /* Athena exports both line-oriented notes and flattened bodies such as
       "HPI: ... Assessment: ... Plan: ...". Prefer explicit colon headings
       and sentence/newline boundaries so the common flattened representation
       seeds formats too, without treating ordinary clinical prose as a label. */
    var headingNames = ORDER.slice().sort(function (a, b) { return b.length - a.length; });
    var escaped = headingNames.map(function (name) { return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
    var inlineRe = new RegExp('(^|[\\r\\n]+|[.!?]\\s+|\\s{2,})(' + escaped + ')\\s*[:：]\\s*', 'gim');
    var spans = [], match;
    while ((match = inlineRe.exec(raw))) spans.push({ heading: String(match[2] || '').toUpperCase(), bodyStart: inlineRe.lastIndex, boundaryStart: match.index });
    if (spans.length) {
      var wanted = HEADING[family] || [];
      for (var si = 0; si < spans.length; si++) {
        if (wanted.indexOf(spans[si].heading) < 0) continue;
        var inlineBody = clean(raw.slice(spans[si].bodyStart, si + 1 < spans.length ? spans[si + 1].boundaryStart : raw.length), 4500);
        if (inlineBody) return spans[si].heading + ':\n' + inlineBody;
      }
    }
    var heads = HEADING[family] || [], lines = raw.split('\n'), start = -1, found = '';
    function headingLine(line) {
      var value = String(line || '').replace(/^\s+|\s+$/g, '').replace(/[:：-]\s*$/, '').toUpperCase();
      return value;
    }
    for (var i = 0; i < lines.length; i++) {
      var hv = headingLine(lines[i]);
      for (var j = 0; j < heads.length; j++) {
        if (hv === heads[j]) { start = i; found = heads[j]; break; }
      }
      if (start >= 0) break;
    }
    if (start < 0) return '';
    var bodyLines = [];
    for (var k = start + 1; k < lines.length; k++) {
      var next = headingLine(lines[k]);
      if (ORDER.indexOf(next) >= 0) break;
      bodyLines.push(lines[k]);
    }
    var body = clean(bodyLines.join('\n'), 4500);
    return body ? found + ':\n' + body : '';
  }
  function visitsFor(patientId) {
    try {
      var M = root.__mlsVisitModel, p = typeof root.findPatient === 'function' ? root.findPatient(patientId) : null;
      if (!M || typeof M.getVisits !== 'function' || !p) return [];
      return (M.getVisits(p) || []).filter(function (v) {
        return v && v.fullDetail === true && v.bodyComplete === true && v.indexOnly !== true &&
          v.identityVerified === true && String(v.identityBinding || '') === String(patientId) && clean(v.raw, 20);
      }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }).slice(0, MAX_VISITS);
    } catch (e) { return []; }
  }
  function examples(patientId) {
    var rows = visitsFor(patientId), out = {};
    FAMILIES.forEach(function (family) {
      /* Raw clinical text never leaves this expression. Convert every section
         to a generic skeleton locally, choose the most common observed layout,
         then expose only that already-safe skeleton to the bootstrap. */
      var candidates = rows.map(function (row) {
        var block = sectionBlock(row.raw, family);
        return block ? fallback(family, block) : null;
      }).filter(Boolean);
      if (!candidates.length) return;
      var byStyle = {};
      candidates.forEach(function (candidate, index) {
        var text = clean(candidate.templateText, 2000);
        var style = /^\s*\d+[.)]\s/m.test(text) ? 'numbered'
          : /^\s*[-*•]\s/m.test(text) ? 'bulleted'
            : /^[A-Za-z][A-Za-z0-9 /&()+.'’-]{0,80}:\s*\[/m.test(text) ? 'labeled' : 'narrative';
        var row = byStyle[style] || (byStyle[style] = { count: 0, best: null, index: index });
        row.count += 1;
        if (!row.best || text.split('\n').length > row.best.templateText.split('\n').length) row.best = candidate;
      });
      var winner = Object.keys(byStyle).map(function (key) { return byStyle[key]; }).sort(function (a, b) {
        return b.count - a.count || a.index - b.index;
      })[0];
      if (winner && winner.best && structuralTemplate(family, winner.best.templateText)) out[family] = winner.best.templateText;
    });
    return out;
  }
  function genericStructureWordsOnly(value) {
    var raw = String(value || '').toLowerCase().replace(/[\[\]]/g, ' ').trim();
    /* Reject the whole label when any digit, non-Latin token or unapproved
       punctuation remains. The old word-only matcher silently ignored dates,
       initials and levels such as L4-L5, then persisted the original label. */
    if (!raw || /[^a-z\s/&()+.'’\-]/.test(raw)) return false;
    var words = raw.replace(/[\/&()+.'’\-]+/g, ' ').match(/[a-z]+/g) || [];
    return !!words.length && words.every(function (word) { return !!GENERIC_STRUCTURE_WORDS[word]; });
  }
  function genericStructureLabel(value) {
    if (!genericStructureWordsOnly(value)) return '';
    var words = String(value || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    return words.map(function (word) {
      return /^(hpi|ros|bmi)$/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }
  function structuralTemplate(family, value) {
    var heads = HEADING[family] || [], sawFamilyHeading = false, lines = clean(value, 2000).split('\n');
    if (!lines.length) return false;
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '').trim();
      if (!line) continue;
      line = line.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '');
      if (/^Use ["']?not documented["']? when the source does not contain a field\.?$/i.test(line)) continue;
      if (/^\[[A-Z][A-Z0-9 _/().,'’-]{2,100}\]$/.test(line)) {
        if (!genericStructureWordsOnly(line)) return false;
        continue;
      }
      var match = /^([A-Za-z][A-Za-z0-9 /&()+.'’-]{0,80}):(?:\s*\[[A-Z][A-Z0-9 _/().,'’-]{2,100}\])*$/.exec(line);
      if (!match || !genericStructureWordsOnly(match[1])) return false;
      if (heads.indexOf(match[1].trim().toUpperCase()) >= 0) sawFamilyHeading = true;
      var placeholders = line.match(/\[[^\]]+\]/g) || [];
      if (placeholders.some(function (placeholder) { return !genericStructureWordsOnly(placeholder); })) return false;
    }
    return sawFamilyHeading;
  }
  function fallback(family, example) {
    var lines = clean(example, 12000).split('\n'), label = String(family || '').toUpperCase(), out = [label + ':'];
    var itemNumber = 0, proseOpen = false, structuralRows = 0;
    lines.slice(1).forEach(function (line) {
      var s = String(line || '').trim();
      if (!s) { proseOpen = false; return; }
      var labeled = s.match(/^(?:[-*•]|\d+[.)])?\s*([^:]{1,64}):/);
      var safeLabel = labeled ? genericStructureLabel(labeled[1]) : '';
      if (safeLabel) {
        out.push(safeLabel + ': [DOCUMENTED FINDING]');
        structuralRows += 1; proseOpen = false; return;
      }
      if (/^[-*•]\s+/.test(s)) {
        if (structuralRows < 6) out.push('- [DOCUMENTED ' + label + ' ITEM]');
        structuralRows += 1; proseOpen = false; return;
      }
      if (/^\d+[.)]\s+/.test(s)) {
        itemNumber += 1;
        if (structuralRows < 6) out.push(itemNumber + '. [DOCUMENTED ' + label + ' ITEM]');
        structuralRows += 1; proseOpen = false; return;
      }
      /* Wrapped prose lines belong to one paragraph. Blank lines reopen a new
         paragraph, preserving narrative-vs-list style without retaining any
         word from the clinical sentence. */
      if (!proseOpen && structuralRows < 3) {
        out.push('[DOCUMENTED ' + label + ' NARRATIVE]');
        structuralRows += 1;
      }
      proseOpen = true;
    });
    if (out.length === 1) out.push('[DOCUMENTED ' + label + ' CONTENT]');
    out.push('Use "not documented" when the source does not contain a field.');
    return { name: 'Imported ' + label + ' format', templateText: out.join('\n'), instructions: 'Preserve this section order and field labels; fill only from the current source note and use not documented for absent fields.' };
  }
  function safeDerived(family, value) {
    value = value && typeof value === 'object' ? value : {};
    var text = clean(value.templateText || value.template || value.templateBody, 2000);
    if (!text || !structuralTemplate(family, text)) return null;
    /* Never persist model-authored prose from a filled note. The model may
       suggest structure, but the durable name and AI comment are fixed,
       account-safe guidance owned by MLS. */
    return {
      name: 'Learned ' + String(family).toUpperCase() + ' format',
      templateText: text,
      instructions: 'Preserve the observed headings, field order, list or narrative structure, and relative detail. Fill only from the current source note; never carry facts from a prior patient, and use not documented for absent fields.'
    };
  }
  function scopedKey(name) { try { return typeof root.uns === 'function' ? root.uns(name) : name; } catch (e) { return name; } }
  function markerKey() { return scopedKey(MARKER); }
  function readMarker() { try { return JSON.parse(root.localStorage.getItem(markerKey()) || 'null'); } catch (e) { return null; } }
  function writeMarker(value) { try { root.localStorage.setItem(markerKey(), JSON.stringify(value)); } catch (e) {} }
  function readPending() {
    try {
      var value = JSON.parse(root.localStorage.getItem(scopedKey(PENDING)) || 'null');
      if (!value || !clean(value.patientId, 120)) return null;
      if (Number(value.at) && Date.now() - Number(value.at) > 7 * 24 * 60 * 60 * 1000) { clearPending(); return null; }
      return value;
    } catch (e) { return null; }
  }
  function clearPending() {
    try {
      if (typeof root.localStorage.removeItem === 'function') root.localStorage.removeItem(scopedKey(PENDING));
      else root.localStorage.setItem(scopedKey(PENDING), '');
    } catch (e) {}
  }
  function hasCustom(family) {
    try {
      var dt = root.__mlsDraftTuning, st = dt && dt.read && dt.read(), f = st && st.families && st.families[family];
      var defaults = dt && typeof dt.defaults === 'function' ? dt.defaults() : null;
      var base = defaults && defaults.families && defaults.families[family] && defaults.families[family].profiles;
      if (!f || !Array.isArray(f.profiles)) return false;
      if (Array.isArray(base) && f.profiles.length !== base.length) return true;
      return f.profiles.some(function (p) {
        p = p || {};
        var d = Array.isArray(base) ? base.filter(function (row) { return row && String(row.id) === String(p.id); })[0] : null;
        /* Shipped profiles can contain explanatory instructions. They are not
           clinician edits and must not block the first-pull bootstrap. */
        if (!d) return true;
        return clean(p.templateText, 3) !== clean(d.templateText, 3) ||
          clean(p.instructions, 600) !== clean(d.instructions, 600) ||
          clean(p.label, 80) !== clean(d.label, 80) || clean(p.when, 180) !== clean(d.when, 180) ||
          clean(p.sectionMode, 48) !== clean(d.sectionMode, 48) || clean(p.templateMode, 48) !== clean(d.templateMode, 48);
      });
    } catch (e) { return false; }
  }
  function derive(family, skeleton) {
    /* The prior note never crosses a network boundary. `skeleton` has already
       passed the generic-word allowlist, so this final validation is defense in
       depth before it reaches durable account settings. */
    return safeDerived(family, { templateText: skeleton }) || fallback(family, '');
  }
  var inFlight = null;
  async function runBootstrap(detail) {
      var patientId = clean(detail && detail.patientId, 120);
      var priorMarker = readMarker(), priorFamilies = priorMarker && Array.isArray(priorMarker.families) ? priorMarker.families : [];
      if (!patientId) return { ok: false, reason: 'missing-patient' };
      if (FAMILIES.every(function (family) { return priorFamilies.indexOf(family) >= 0; })) return { ok: false, reason: 'already-bootstrapped' };
      var dt = root.__mlsDraftTuning;
      if (!dt || typeof dt.profileEditor !== 'function') return { ok: false, reason: 'draft-tuning-not-ready' };
      var ex = examples(patientId), made = [];
      for (var i = 0; i < FAMILIES.length; i++) {
        var family = FAMILIES[i];
        if (priorFamilies.indexOf(family) >= 0 || !ex[family] || hasCustom(family)) continue;
        var row = derive(family, ex[family]);
        try {
          var editor = dt.profileEditor(family), list = editor && editor.list && editor.list(), target = list && list[0];
          /* Re-check after the async derivation and immediately before the
             write: a clinician may have edited a format while this was in
             flight, and their edit must always win. */
          if (target && !hasCustom(family) && editor.update(target.id, { templateText: row.templateText, instructions: row.instructions, label: row.name })) made.push(family);
        } catch (e) {}
      }
      var satisfied = priorFamilies.slice();
      FAMILIES.forEach(function (family) {
        if ((made.indexOf(family) >= 0 || hasCustom(family)) && satisfied.indexOf(family) < 0) satisfied.push(family);
      });
      if (satisfied.length) writeMarker({ version: VERSION, status: satisfied.length === FAMILIES.length ? 'complete' : 'partial', families: satisfied, at: Date.now() });
      if (made.length) { try { if (typeof root.toast === 'function') root.toast('MLS created PHI-free starter formats from the first full Athena history pull. Review them in Settings → Notes & AI.', 'ok'); } catch (e) {} }
      return made.length || satisfied.length
        ? { ok: true, families: made.slice(), status: satisfied.length === FAMILIES.length ? 'complete' : 'partial' }
        : { ok: false, families: [], reason: 'no-usable-verified-notes' };
  }
  async function withCrossTabLock(work) {
    var locks = root.navigator && root.navigator.locks;
    if (locks && typeof locks.request === 'function') return locks.request('mls-first-pull-style-bootstrap', { mode: 'exclusive' }, work);
    /* Chrome supplies Web Locks. This lease is a best-effort fallback for test
       harnesses/older engines; the marker is re-read inside `work` as a final
       idempotency guard. */
    var key = scopedKey(LOCK), token = String(Date.now()) + ':' + String(Math.random()).slice(2), now = Date.now();
    try {
      var current = JSON.parse(root.localStorage.getItem(key) || 'null');
      if (current && Number(current.until) > now) return { ok: false, reason: 'bootstrap-busy' };
      root.localStorage.setItem(key, JSON.stringify({ token: token, until: now + 30000 }));
      await Promise.resolve();
      current = JSON.parse(root.localStorage.getItem(key) || 'null');
      if (!current || current.token !== token) return { ok: false, reason: 'bootstrap-busy' };
    } catch (e) {}
    try { return await work(); }
    finally {
      try {
        var owned = JSON.parse(root.localStorage.getItem(key) || 'null');
        if (owned && owned.token === token) {
          if (typeof root.localStorage.removeItem === 'function') root.localStorage.removeItem(key);
          else root.localStorage.setItem(key, '');
        }
      } catch (e) {}
    }
  }
  function bootstrap(detail) {
    /* Share one tab-local run and take an origin-wide Web Lock so duplicate
       completion events/tabs cannot both initialize the same account. */
    if (inFlight) return inFlight;
    inFlight = withCrossTabLock(function () { return runBootstrap(detail); });
    inFlight = inFlight.then(function (result) { inFlight = null; return result; }, function (err) { inFlight = null; throw err; });
    return inFlight;
  }
  var api = { installed: true, version: VERSION, bootstrap: bootstrap, _examples: examples, _sectionBlock: sectionBlock, _fallback: fallback, _safeDerived: safeDerived };
  root.__mlsFirstPullStyle = api;
  /* Live QA must be able to prove execution without reading app globals from
     the browser automation sandbox. The loader's onload bit proves only that
     bytes arrived; this DOM marker is written by the module itself after its
     API is installed. It contains no account or patient data. */
  try { root.document.documentElement.setAttribute('data-mls-first-pull-style-ready', VERSION); } catch (e) {}
  function onPull(ev) {
    var pending = readPending(), d = pending || ev && ev.detail || {};
    /* Draft tuning is intentionally lazy. A pull can finish before Settings or
       generation has loaded it, so wait for the same bounded loader instead of
       silently losing the one-time bootstrap event. */
    var ready = typeof root.__mlsEnsureDraftTuning === 'function'
      ? root.__mlsEnsureDraftTuning()
      : Promise.resolve(root.__mlsDraftTuning || null);
    Promise.resolve(ready).then(function () { return bootstrap(d); }).then(function (result) {
      /* Consume this receipt after a real attempt. A later full pull writes a
         fresh receipt, so partial/no-usable families remain eligible to retry
         without replaying the same patient on every page load. */
      if (pending && result && result.reason !== 'draft-tuning-not-ready' && result.reason !== 'bootstrap-busy') clearPending();
      return result;
    }).catch(function () {});
  }
  try { root.addEventListener('mls:athena-full-history-pull-complete', onPull); } catch (e) {}
  /* Durable replay closes the asynchronous loader race: if the first complete
     pull finished before this script subscribed, its local receipt is handled
     as soon as the module is ready. */
  if (readPending()) Promise.resolve().then(function () { onPull(null); });
})(window);
