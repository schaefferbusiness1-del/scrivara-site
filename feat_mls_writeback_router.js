/* feat_mls_writeback_router.js  ->  window.__mlsWbRouter  (wbr-1.0.0)
 * --------------------------------------------------------------------------
 * SMART ADAPTIVE WRITEBACK LOCATION (per-doctor preferences).
 *
 * One source of truth for WHERE each kind of MLS output gets written into
 * athenaOne. The doctor can change any destination in plain English through the
 * MLS Assistant chat ("put injections under Physical Exam instead"), and every
 * writeback path (op-note, Simple auto-send, codes) reads its destination from
 * HERE so a single instruction actually changes where things land.
 *
 * Stored PER DOCTOR in localStorage ('mlsWbPrefs:<doctorId>'), merged over the
 * built-in defaults. No PHI is stored - only routing labels / section / template
 * names. Pure routing data; this module never touches the chart itself.
 *
 * Additive, idempotent, reversible (window.__mlsWbRouter.revert()). ASCII-only.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsWbRouter && window.__mlsWbRouter.installed) return; } catch (e) { return; }
  var VERSION = 'wbr-1.0.0';

  function g(n) { try { return window[n]; } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---- which doctor are we routing for (non-PHI id only) ---- */
  function doctorId() {
    var id = safe(function () {
      var u = g('bkUser'); if (u && (u.id != null)) return 'u' + u.id;
      if (u && u.email) return String(u.email).toLowerCase();
      return '';
    }, '');
    if (!id) id = safe(function () {
      var ap = g('activePatient'); var p = isFn(ap) ? ap() : null;
      var d = p && (p.doctor_user_id || p.provider_id || p.providerId);
      return d != null ? 'd' + d : '';
    }, '');
    if (!id) id = safe(function () { return localStorage.getItem('mlsDoctorId') || ''; }, '');
    return id || 'default';
  }

  /* ---- the kinds of output we route + their built-in athenaOne destinations ----
     section keys line up with the extension field-scanner sections so the writeback
     engine can target by them. label = human text shown to the doctor. */
  var DEFAULTS = {
    opnote: {
      kind: 'opnote', tab: 'PE', section: 'procedure', sectionName: 'Procedure Documentation',
      template: 'Injection Generic Template', addTemplate: true, clearFirst: true,
      label: 'PE > Procedure Documentation > "Injection Generic Template" (erase the skeleton, insert the op-note)'
    },
    note: {
      kind: 'note', section: 'progress', sectionName: 'Clinical note', addTemplate: false, clearFirst: false,
      label: 'the open chart clinical note field'
    },
    dx: {
      kind: 'dx', section: 'diagnoses', sectionName: 'Diagnoses (ICD-10)', addTemplate: false, clearFirst: false,
      label: 'the Diagnoses / ICD-10 field'
    },
    cpt: {
      kind: 'cpt', section: 'orders', sectionName: 'Orders / Procedure codes (CPT)', addTemplate: false, clearFirst: false,
      label: 'the Orders / CPT field'
    }
  };

  function lsKey() { return 'mlsWbPrefs:' + doctorId(); }
  function loadPrefs() { return safe(function () { var raw = localStorage.getItem(lsKey()); return raw ? (JSON.parse(raw) || {}) : {}; }, {}); }
  function savePrefs(p) { safe(function () { localStorage.setItem(lsKey(), JSON.stringify(p || {})); }); }

  function get(kind) {
    kind = canonKind(kind) || 'note';
    var base = clone(DEFAULTS[kind] || DEFAULTS.note);
    var saved = loadPrefs()[kind] || {};
    for (var k in saved) { if (saved.hasOwnProperty(k)) base[k] = saved[k]; }
    base.label = labelFor(base);
    return base;
  }
  function all() { return { opnote: get('opnote'), note: get('note'), dx: get('dx'), cpt: get('cpt') }; }

  function labelFor(t) {
    if (t.kind === 'opnote') {
      var where = (t.tab ? t.tab + ' > ' : '') + (t.sectionName || 'Procedure Documentation');
      if (t.template) where += ' > "' + t.template + '"';
      return where + (t.clearFirst ? ' (erase the skeleton, insert the op-note)' : ' (insert the op-note)');
    }
    if (t.sectionName) return 'the ' + t.sectionName + ' field';
    return DEFAULTS[t.kind] ? DEFAULTS[t.kind].label : 'the chart';
  }

  function setTarget(kind, patch) {
    kind = canonKind(kind); if (!kind) return null;
    var p = loadPrefs(); var cur = p[kind] || {};
    for (var k in patch) { if (patch.hasOwnProperty(k) && patch[k] != null && trim(patch[k]) !== '') cur[k] = patch[k]; }
    p[kind] = cur; savePrefs(p);
    return get(kind);
  }
  function reset(kind) { var p = loadPrefs(); if (kind) { delete p[canonKind(kind)]; } else { p = {}; } savePrefs(p); return kind ? get(kind) : all(); }

  function canonKind(s) {
    s = trim(s).toLowerCase(); if (!s) return null;
    if (['opnote', 'note', 'dx', 'cpt'].indexOf(s) >= 0) return s;
    if (/inject|op[\s-]?note|operative|procedure note|procedure doc|\besi\b|\bmbb\b|\brfa\b|nerve block|\bblock\b/.test(s)) return 'opnote';
    if (/diagnos|icd|problem/.test(s)) return 'dx';
    if (/\bcpt\b|billing|charge|\border|procedure code|e\/?m\b|superbill/.test(s)) return 'cpt';
    if (/\bnote\b|narrative|soap|clinical note|progress/.test(s)) return 'note';
    return null;
  }
  function kindNoun(kind) {
    return { opnote: 'Op-notes / injection procedure notes', note: 'The clinical note', dx: 'Diagnoses (ICD-10)', cpt: 'Billing / CPT codes' }[kind] || kind;
  }

  function describe() {
    var a = all();
    var lines = ['Here is where MLS will write each thing in athenaOne right now (doctor: ' + doctorId() + '):'];
    lines.push('- Op-notes / injections -> ' + a.opnote.label + '.');
    lines.push('- Clinical note -> ' + a.note.label + '.');
    lines.push('- Diagnoses (ICD-10) -> ' + a.dx.label + '.');
    lines.push('- Billing / CPT codes -> ' + a.cpt.label + '.');
    lines.push('You can change any of these by telling me, e.g. "put injections under Physical Exam instead" or "use the Lumbar ESI template for injections".');
    return lines.join('\n');
  }

  /* ---- parse a plain-English location command -> { matched, kind, target, change, reply } ---- */
  function parseCommand(text) {
    var t = trim(text); if (!t) return { matched: false };
    var low = t.toLowerCase();

    // "where do(es) X go" -> describe, no change
    if (/(where|what)\b/.test(low) && /(go|going|write|written|land|destination|send|sent|put|save|saved)/.test(low) &&
        !/\b(put|change|move|route|set|use|switch|file|place)\s+(injection|op|note|diagn|code|cpt|billing|the)/.test(low)) {
      return { matched: true, kind: null, target: null, change: false, reply: describe() };
    }

    var isChange = /\b(put|move|route|send|write|set|use|change|switch|file|place)\b/.test(low);
    if (!isChange) return { matched: false };

    var kind = canonKind(low);

    var tmpl = null;
    var tm = /\buse (?:the )?["']?([a-z0-9 ./()&-]{3,60}?)["']? template\b/i.exec(t) ||
             /\btemplate (?:called |named )?["']([^"']{3,60})["']/i.exec(t);
    if (tm) { tmpl = trim(tm[1]); if (!kind) kind = 'opnote'; }

    var dest = null;
    var dm = /\b(?:under|into|in|to|onto|on)\s+(?:the\s+)?["']?([a-z][a-z0-9 ./()&-]{2,48}?)["']?\s*(?:tab|section|field|template|instead|\.|,|$)/i.exec(t);
    if (dm) dest = trim(dm[1]);

    if (!kind) kind = canonKind(dest || '') || null;
    if (!kind) return { matched: false };

    var patch = {};
    if (tmpl) { patch.template = tmpl; patch.addTemplate = true; }
    if (dest && !/template/i.test(dest)) {
      patch.sectionName = titleCase(dest);
      var sec = sectionFromName(dest); if (sec) patch.section = sec;
      if (kind === 'opnote') { var th = tabHint(dest); if (th) patch.tab = th; }
    }
    if (!tmpl && !dest) return { matched: false };

    var updated = setTarget(kind, patch);
    var reply = 'Done - ' + kindNoun(kind).replace(/^The /, 'the ') + ' will now be written to ' + updated.label + '.';
    if (kind === 'opnote' && tmpl) reply += ' I will add/erase that template before inserting the note.';
    reply += '\nTell me "where does everything go?" any time to review all destinations.';
    return { matched: true, kind: kind, target: updated, change: true, reply: reply };
  }

  function titleCase(s) { return String(s || '').replace(/\b([a-z])/g, function (m, c) { return c.toUpperCase(); }); }
  function tabHint(s) { s = s.toLowerCase(); if (/physical exam|\bpe\b/.test(s)) return 'PE'; if (/assess|\ba\/?p\b|plan/.test(s)) return 'A/P'; if (/\bhpi\b/.test(s)) return 'HPI'; if (/\bros\b/.test(s)) return 'ROS'; return ''; }
  function sectionFromName(s) {
    s = s.toLowerCase();
    if (/procedure|operative|op note/.test(s)) return 'procedure';
    if (/diagnos|icd|problem/.test(s)) return 'diagnoses';
    if (/order|cpt|billing|charge/.test(s)) return 'orders';
    if (/assess|plan|a\/?p/.test(s)) return 'assessment_plan';
    if (/physical exam|\bpe\b|exam/.test(s)) return 'physical_exam';
    if (/\bhpi\b|history of present/.test(s)) return 'hpi';
    if (/\bros\b|review of systems/.test(s)) return 'ros';
    if (/note|narrative|progress|soap/.test(s)) return 'progress';
    return '';
  }

  function revert() { try { window.__mlsWbRouter.installed = false; } catch (e) {} }

  window.__mlsWbRouter = {
    installed: true, version: VERSION, asset: 'feat_mls_writeback_router.js',
    doctorId: doctorId, get: get, all: all, setTarget: setTarget, reset: reset,
    describe: describe, parseCommand: parseCommand, canonKind: canonKind,
    _defaults: DEFAULTS, revert: revert
  };
})();
