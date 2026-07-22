/* =====================================================================
   MLS Op-Note PRO  (mls-opnote-pro.js)
   ---------------------------------------------------------------------
   Two upgrades to MLS operative / procedure notes, delivered as ONE
   self-contained, progressive-enhancement asset (loaded by a one-line
   loader appended to the mls-connect(.staging).js bundle; ScribeFlow.html
   is NOT edited):

   PART 1 — PROFESSIONAL OP-NOTE FORMAT (not a summary)
     • A lossless normalizer rewrites whatever op-note text exists into a
       full, properly-structured operative note with real headings, in the
       standard order a payer/peer reviewer expects:
         PATIENT / DOB / MRN / DATE OF PROCEDURE / PROVIDER (/ ASSISTANT),
         PREOPERATIVE DIAGNOSIS, POSTOPERATIVE DIAGNOSIS,
         PROCEDURE(S) PERFORMED (with CPT), ANESTHESIA,
         INDICATIONS FOR PROCEDURE, CONSENT, FINDINGS,
         DESCRIPTION OF PROCEDURE (detailed, step-by-step),
         ESTIMATED BLOOD LOSS, COMPLICATIONS, SPECIMENS,
         DISPOSITION / POST-PROCEDURE PLAN,
         DIAGNOSIS CODES (ICD-10), PROCEDURE CODES (CPT).
     • It NEVER invents clinical facts: a section the source does not
       support is left as a clearly-marked "[not dictated]" placeholder,
       and every line of the source note is preserved (nothing dropped).
     • The deterministic injection-note builder (generateProcNote ->
       #procNoteBody) is wrapped so its output lands already in this
       professional format. The AI template-adapt path (_genOpNote, used by
       "Prep op notes") gets an enhanced system prompt that enforces the
       same structure + no-fabrication discipline while still following the
       doctor's uploaded template. Both wraps keep the originals and fall
       back to them on ANY error, so generation can never break.
     • On screen the headings render bold/sectioned via the existing
       __mlsFormat preview (which already styles #procNoteBody) — this asset
       just makes sure the underlying text carries the headings.

   PART 2 — SAVE OP NOTE TO PDF
     • A "Save as PDF" button on the op-note views (the Procedure-Note
       builder, the History op-note viewer, and each Prep-op-note row).
     • Builds a clean, professional PDF with REAL selectable text (not a
       screenshot): bold heading hierarchy, readable typography, letter-size
       page margins, page numbers, a letterhead line (provider + date by
       default; clinic name/address configurable — see MLS_OPNOTE_LETTERHEAD
       below), and the normalized section headings.
     • Filename: OpNote_<patient>_<date>.pdf  (no PHI is written to logs).
     • Uses the app's own loadJsPdf() (jsPDF 4.2.1) when present, else lazy-
       loads the same pinned same-origin build itself.

   Discipline: own IIFE, all external work in try/catch, no required globals
   (every dependency is feature-detected), degrades to a silent no-op on any
   error. Exposes window.__mlsOpNotePro for diagnostics.
   ===================================================================== */
(function () {
  'use strict';
  if (window.__mlsOpNotePro) return;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  /* ---------------------------------------------------------------
     LETTERHEAD CONFIG — set this once to put your practice letterhead on
     every exported op-note PDF. Leave clinicName empty for a clean
     default header (provider name + date). Example to set later:

       window.MLS_OPNOTE_LETTERHEAD = {
         clinicName: 'MLS Spine & Pain Center',
         addressLines: ['1234 Example Blvd, Suite 200',
                        'Phoenix, AZ 85016',
                        'Tel (480) 555-0100 · Fax (480) 555-0101'],
       };
     --------------------------------------------------------------- */
  if (!window.MLS_OPNOTE_LETTERHEAD) {
    window.MLS_OPNOTE_LETTERHEAD = { clinicName: '', addressLines: [] };
  }

  var NOT_DICTATED = '[not dictated]';

  /* =============================================================
     SECTION MODEL — canonical operative-note headings, in order.
     ============================================================= */
  var CANON = [
    'PREOPERATIVE DIAGNOSIS',
    'POSTOPERATIVE DIAGNOSIS',
    'PROCEDURE(S) PERFORMED',
    'ANESTHESIA',
    'INDICATIONS FOR PROCEDURE',
    'CONSENT',
    'FINDINGS',
    'DESCRIPTION OF PROCEDURE',
    'ESTIMATED BLOOD LOSS',
    'COMPLICATIONS',
    'SPECIMENS',
    'DISPOSITION / POST-PROCEDURE PLAN',
    'DIAGNOSIS CODES (ICD-10)',
    'PROCEDURE CODES (CPT)'
  ];

  // Map a source heading (lower-cased, colon/space-trimmed) -> canonical key.
  var ALIAS = {
    'preoperative diagnosis': 'PREOPERATIVE DIAGNOSIS',
    'pre-operative diagnosis': 'PREOPERATIVE DIAGNOSIS',
    'preprocedure diagnosis': 'PREOPERATIVE DIAGNOSIS',
    'pre-procedure diagnosis': 'PREOPERATIVE DIAGNOSIS',
    'postoperative diagnosis': 'POSTOPERATIVE DIAGNOSIS',
    'post-operative diagnosis': 'POSTOPERATIVE DIAGNOSIS',
    'postprocedure diagnosis': 'POSTOPERATIVE DIAGNOSIS',
    'post-procedure diagnosis': 'POSTOPERATIVE DIAGNOSIS',
    'procedure': 'PROCEDURE(S) PERFORMED',
    'procedures': 'PROCEDURE(S) PERFORMED',
    'procedure performed': 'PROCEDURE(S) PERFORMED',
    'procedures performed': 'PROCEDURE(S) PERFORMED',
    'procedure(s) performed': 'PROCEDURE(S) PERFORMED',
    'operation': 'PROCEDURE(S) PERFORMED',
    'operation performed': 'PROCEDURE(S) PERFORMED',
    'anesthesia': 'ANESTHESIA',
    'anesthesia type': 'ANESTHESIA',
    'sedation': 'ANESTHESIA',
    'indication': 'INDICATIONS FOR PROCEDURE',
    'indications': 'INDICATIONS FOR PROCEDURE',
    'indications for procedure': 'INDICATIONS FOR PROCEDURE',
    'indication for procedure': 'INDICATIONS FOR PROCEDURE',
    'consent': 'CONSENT',
    'informed consent': 'CONSENT',
    'findings': 'FINDINGS',
    'description of procedure': 'DESCRIPTION OF PROCEDURE',
    'description': 'DESCRIPTION OF PROCEDURE',
    'technique': 'DESCRIPTION OF PROCEDURE',
    'procedure in detail': 'DESCRIPTION OF PROCEDURE',
    'estimated blood loss': 'ESTIMATED BLOOD LOSS',
    'ebl': 'ESTIMATED BLOOD LOSS',
    'complications': 'COMPLICATIONS',
    'specimens': 'SPECIMENS',
    'specimen': 'SPECIMENS',
    'disposition': 'DISPOSITION / POST-PROCEDURE PLAN',
    'condition': 'DISPOSITION / POST-PROCEDURE PLAN',
    'post-procedure plan': 'DISPOSITION / POST-PROCEDURE PLAN',
    'postprocedure plan': 'DISPOSITION / POST-PROCEDURE PLAN',
    'post-procedure': 'DISPOSITION / POST-PROCEDURE PLAN',
    'post procedure plan': 'DISPOSITION / POST-PROCEDURE PLAN',
    'plan': 'DISPOSITION / POST-PROCEDURE PLAN',
    'follow-up': 'DISPOSITION / POST-PROCEDURE PLAN',
    'diagnosis codes': 'DIAGNOSIS CODES (ICD-10)',
    'diagnosis codes (icd-10)': 'DIAGNOSIS CODES (ICD-10)',
    'icd-10': 'DIAGNOSIS CODES (ICD-10)',
    'icd10': 'DIAGNOSIS CODES (ICD-10)',
    'procedure codes': 'PROCEDURE CODES (CPT)',
    'procedure codes (cpt)': 'PROCEDURE CODES (CPT)',
    'cpt': 'PROCEDURE CODES (CPT)',
    'cpt codes': 'PROCEDURE CODES (CPT)'
  };

  // Header fields we lift out of the top of a note into the demographics block.
  var HEADER_KEYS = {
    'patient': 'patient', 'patient name': 'patient', 'name': 'patient',
    'dob': 'dob', 'date of birth': 'dob',
    'mrn': 'mrn', 'medical record number': 'mrn',
    'date of procedure': 'dop', 'date': 'dop', 'date/time': 'dop',
    'date of service': 'dop', 'service date': 'dop',
    'provider': 'provider', 'surgeon': 'provider', 'attending': 'provider',
    'physician': 'provider', 'operating physician': 'provider',
    'assistant': 'assistant', 'assistant surgeon': 'assistant', 'first assistant': 'assistant'
  };

  function stripColon(s) { return String(s == null ? '' : s).replace(/\s*:\s*$/, '').trim(); }
  function looksLikeHeading(label) {
    // ALL-CAPS-ish (no lowercase letters), reasonable length, no sentence punctuation.
    var l = stripColon(label);
    if (!l || l.length > 60) return false;
    if (/[a-z]/.test(l)) return false;          // contains lowercase -> not a heading
    if (!/[A-Z]/.test(l)) return false;          // must have a letter
    if (/[.;]/.test(l)) return false;
    return true;
  }

  // Resolve a source heading label to a canonical key. Tolerant of a TRAILING
  // parenthetical qualifier (e.g. "procedure(s) performed (with cpt)" ->
  // "PROCEDURE(S) PERFORMED") so a heading variant is folded into its canonical
  // section instead of being emitted a SECOND time as an unmatched block — which
  // previously produced a DOUBLED heading in both the PDF and the on-screen view.
  function aliasFor(lkey) {
    lkey = String(lkey == null ? '' : lkey).toLowerCase().trim();
    if (ALIAS[lkey]) return ALIAS[lkey];
    var stripped = lkey.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (stripped && stripped !== lkey && ALIAS[stripped]) return ALIAS[stripped];
    return null;
  }

  /* Parse a raw op-note string into {header:{}, order:[], sec:{key->[lines]}, unmatched:[]}.
     - header: demographics lifted from "Key: value" lines at the very top.
     - sec: canonical-keyed section bodies (array of text lines).
     - unmatched: source sections whose heading had no canonical alias (kept
       verbatim so nothing is ever lost).  */
  function parseNote(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var header = {};
    var sec = {};            // canonical key -> [lines]
    var order = [];          // canonical keys in first-seen order
    var unmatched = [];      // [{h, body:[lines]}]
    var i = 0, inHeaderZone = true, cur = null, curUn = null;

    function pushCanon(key, firstLine) {
      if (!sec[key]) { sec[key] = []; order.push(key); }
      if (firstLine != null && firstLine !== '') sec[key].push(firstLine);
      cur = key; curUn = null;
    }
    function pushUnmatched(h, firstLine) {
      curUn = { h: h, body: [] };
      if (firstLine != null && firstLine !== '') curUn.body.push(firstLine);
      unmatched.push(curUn); cur = null;
    }

    for (i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.replace(/\s+$/, '');
      var trimmed = line.trim();

      // "Label: value" — split label/value.
      var m = trimmed.match(/^([A-Za-z][A-Za-z0-9 /&()'.\-]{0,48}?)\s*:\s*(.*)$/);
      var label = m ? m[1].trim() : '';
      var value = m ? m[2].trim() : '';
      var lkey = label.toLowerCase();

      // --- Header zone: consume leading demographic "Key: value" lines ---
      if (inHeaderZone) {
        if (!trimmed) { continue; }                       // skip blank lines at the very top
        if (/^procedure note$/i.test(trimmed) || /^operative note$/i.test(trimmed)) { continue; } // title line
        if (m && HEADER_KEYS[lkey]) { header[HEADER_KEYS[lkey]] = value; continue; }
        inHeaderZone = false;                              // first non-header line ends the zone
      }

      // --- Section heading detection ---
      if (m && (aliasFor(lkey) || looksLikeHeading(label))) {
        var canon = aliasFor(lkey);
        if (canon) { pushCanon(canon, value); continue; }
        pushUnmatched(label.toUpperCase(), value); continue;
      }
      // A standalone ALL-CAPS line with no colon is also a heading.
      if (!m && trimmed && looksLikeHeading(trimmed)) {
        var c2 = aliasFor(trimmed.toLowerCase());
        if (c2) { pushCanon(c2, ''); continue; }
        pushUnmatched(stripColon(trimmed).toUpperCase(), ''); continue;
      }

      // --- Body line: attach to current section / unmatched / preamble ---
      if (cur) { sec[cur].push(line); }
      else if (curUn) { curUn.body.push(line); }
      else { (sec.__pre = sec.__pre || []).push(line); }   // text before any heading
    }
    return { header: header, sec: sec, order: order, unmatched: unmatched };
  }

  function bodyText(arr) {
    if (!arr || !arr.length) return '';
    // trim leading/trailing blank lines
    var a = arr.slice();
    while (a.length && !a[0].trim()) a.shift();
    while (a.length && !a[a.length - 1].trim()) a.pop();
    return a.join('\n');
  }

  // Pull code-like tokens out of free text (used ONLY to surface codes that are
  // literally present — never to invent them).
  function findIcd10(text) {
    var out = [], seen = {};
    var re = /\b([A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?)\b/g, mm;
    while ((mm = re.exec(String(text || '')))) { var c = mm[1].toUpperCase(); if (!seen[c]) { seen[c] = 1; out.push(c); } }
    return out;
  }
  function findCpt(text) {
    var out = [], seen = {};
    var re = /\b(\d{5}|\d{4}[FT])\b/g, mm;
    while ((mm = re.exec(String(text || '')))) { var c = mm[1].toUpperCase(); if (!seen[c]) { seen[c] = 1; out.push(c); } }
    return out;
  }

  /* Build the meta (demographics) we know from the app, to backfill the header. */
  function appMeta() {
    var meta = { patient: '', dob: '', mrn: '', provider: '', spec: '' };
    safe(function () {
      var ap = (typeof activePatient === 'function') ? activePatient() : null;
      if (ap) { meta.patient = ap.name || ''; meta.dob = ap.dob || ''; meta.mrn = ap.mrn || ''; }
    });
    safe(function () { if (typeof getName === 'function') meta.provider = getName() || ''; });
    safe(function () { if (typeof getSpec === 'function') meta.spec = getSpec() || ''; });
    return meta;
  }

  /* The core PART-1 transform: raw op-note text -> full professional op note
     (plain text, real newlines, headings, [not dictated] placeholders).
     LOSSLESS: every source line ends up somewhere; missing => placeholder. */
  /* A "Name:"/"Patient:" line whose value reads like a procedure or template
     title (e.g. "Name: QA Bilateral Lumbar Facet Injection") is template
     metadata, never a patient identity. */
  function looksLikeProcedureTitle(s) {
    return /injection|block|ablation|epidural|facet|rhizotomy|stimulator|kyphoplasty|vertebroplasty|discography|denervation|procedure note|op note|template/i.test(String(s || ''));
  }
  function normalize(text, meta) {
    meta = meta || {};
    var p = parseNote(text);
    var H = p.header;

    // Late demographic lines: the header zone ends at the first non-header
    // line (e.g. a leaked template metadata line), which used to leave
    // Patient:/DOB: lines in the body AND a second demographics block on top
    // — duplicated, contradictory headers. Lift them out of the preamble so
    // identity renders exactly once.
    if (p.sec.__pre) {
      p.sec.__pre = p.sec.__pre.filter(function (line) {
        var mm = line.trim().match(/^([A-Za-z][A-Za-z0-9 /&()'.\-]{0,48}?)\s*:\s*(.*)$/);
        if (!mm) return true;
        var hk = HEADER_KEYS[mm[1].trim().toLowerCase()];
        if (!hk) return true;
        if (!H[hk]) H[hk] = mm[2].trim();
        return false;
      });
    }
    if (H.patient && looksLikeProcedureTitle(H.patient)) H.patient = '';

    // Resolve demographics. PATIENT IDENTITY comes from the app's verified
    // active-patient chart first — a note/template header can fill gaps but
    // never override the bound chart. Procedure date and provider prefer the
    // note (they are note-specific facts).
    var patient = meta.patient || H.patient || '';
    var dob = meta.dob || H.dob || '';
    var mrn = meta.mrn || H.mrn || '';
    var dop = H.dop || meta.dop || '';
    var provider = H.provider || meta.provider || '';
    if (provider && meta.spec && provider.indexOf(meta.spec) < 0) provider = provider; // keep as-is
    var assistant = H.assistant || '';

    var out = [];
    out.push('OPERATIVE / PROCEDURE NOTE');
    out.push('');
    out.push('Patient: ' + (patient || NOT_DICTATED));
    out.push('DOB: ' + (dob || NOT_DICTATED));
    out.push('MRN: ' + (mrn || NOT_DICTATED));
    out.push('Date of Procedure: ' + (dop || NOT_DICTATED));
    out.push('Provider: ' + (provider || NOT_DICTATED) + (meta.spec && (provider.indexOf(meta.spec) < 0) ? (' (' + meta.spec + ')') : ''));
    if (assistant) out.push('Assistant: ' + assistant);
    out.push('');

    var sec = p.sec;
    function get(key) { return bodyText(sec[key]); }
    function has(key) { return !!(sec[key] && bodyText(sec[key]).trim()); }

    // ---- Derived / mapped content for canonical sections ----
    var indication = get('INDICATIONS FOR PROCEDURE');
    var procPerf = get('PROCEDURE(S) PERFORMED');

    // Preop diagnosis: explicit, else derive from indication's diagnosis text.
    var preop = get('PREOPERATIVE DIAGNOSIS');
    if (!preop.trim() && indication.trim()) {
      // first clause of the indication, ICD list stripped
      preop = indication.split('\n')[0].replace(/\s*·?\s*ICD-?10:.*$/i, '').trim();
    }
    var postop = get('POSTOPERATIVE DIAGNOSIS');
    if (!postop.trim()) postop = preop.trim() ? 'Same as preoperative diagnosis.' : '';

    // Anesthesia: explicit, else infer "local" from a documented local-anesthetic mention.
    var anesthesia = get('ANESTHESIA');
    if (!anesthesia.trim()) {
      var whole = String(text || '').toLowerCase();
      if (/local anesthetic|lidocaine|local anesthesia|infiltrat/.test(whole)) {
        anesthesia = 'Local anesthetic (see Description of Procedure).';
      }
    }

    // Description of procedure: prefer explicit DESCRIPTION; else assemble from
    // the deterministic builder's PRE-PROCEDURE / TIME-OUT / TECHNIQUE / MEDICATIONS
    // blocks so a full step-by-step is preserved.
    var desc = get('DESCRIPTION OF PROCEDURE');
    if (!desc.trim()) {
      var parts = [];
      ['__pre'].forEach(function () {}); // noop, keep linter calm
      var pre = bodyText(sec['PRE-PROCEDURE'] || (function () { for (var k in sec) { if (/^PRE-?PROCEDURE$/i.test(k)) return sec[k]; } return null; })());
      // unmatched blocks that are clearly part of technique
      var techBits = [];
      p.unmatched.forEach(function (u) {
        if (/TIME-?OUT|TECHNIQUE|MEDICATIONS? INJECTED|MEDICATIONS? ADMINISTERED|PRE-?PROCEDURE|POSITIONING|PREP/i.test(u.h)) {
          techBits.push(u.h + ':');
          var b = bodyText(u.body); if (b) techBits.push(b);
          u.__consumed = true;
        }
      });
      if (techBits.length) desc = techBits.join('\n');
    }

    // Consent: explicit section, else a "Consent:" line found anywhere in the note.
    var consent = get('CONSENT');
    if (!consent.trim()) {
      var cm = String(text || '').match(/consent[^\n]*:?[^\n]*/i);
      // prefer a line that actually states consent was/was not obtained
      var cl = String(text || '').split('\n').filter(function (x) { return /consent/i.test(x); });
      if (cl.length) consent = cl.map(function (x) { return x.replace(/^[\s\-•]+/, '').trim(); }).join('\n');
    }

    var findings = get('FINDINGS');
    var ebl = get('ESTIMATED BLOOD LOSS');
    var comps = get('COMPLICATIONS');
    var specimens = get('SPECIMENS');
    var dispo = get('DISPOSITION / POST-PROCEDURE PLAN');

    // Codes: surface only codes literally present in the note (no invention).
    var icdCodes = get('DIAGNOSIS CODES (ICD-10)');
    if (!icdCodes.trim()) {
      var found = findIcd10(indication + '\n' + (sec.__pre ? bodyText(sec.__pre) : ''));
      // also scan an explicit "ICD-10:" list on the indication line
      var icdInline = (String(indication).match(/ICD-?10:\s*([^\n]+)/i) || [])[1] || '';
      if (icdInline) found = found.concat(findIcd10(icdInline));
      var uniq = {}; found = found.filter(function (c) { if (uniq[c]) return false; uniq[c] = 1; return true; });
      icdCodes = found.length ? found.join(', ') : '';
    }
    var cptCodes = get('PROCEDURE CODES (CPT)');
    if (!cptCodes.trim()) {
      var cf = findCpt(procPerf);
      cptCodes = cf.length ? cf.join(', ') : '';
    }

    // ---- Resolved value per canonical key ----
    var resolved = {
      'PREOPERATIVE DIAGNOSIS': preop,
      'POSTOPERATIVE DIAGNOSIS': postop,
      'PROCEDURE(S) PERFORMED': procPerf + (cptCodes && procPerf.indexOf(cptCodes) < 0 ? ('\nCPT: ' + cptCodes) : ''),
      'ANESTHESIA': anesthesia,
      'INDICATIONS FOR PROCEDURE': indication,
      'CONSENT': consent,
      'FINDINGS': findings,
      'DESCRIPTION OF PROCEDURE': desc,
      'ESTIMATED BLOOD LOSS': ebl,
      'COMPLICATIONS': comps,
      'SPECIMENS': specimens,
      'DISPOSITION / POST-PROCEDURE PLAN': dispo,
      'DIAGNOSIS CODES (ICD-10)': icdCodes,
      'PROCEDURE CODES (CPT)': cptCodes
    };

    CANON.forEach(function (key) {
      var v = (resolved[key] == null ? '' : String(resolved[key])).trim();
      out.push(key + ':');
      out.push(v ? v : NOT_DICTATED);
      out.push('');
    });

    // ---- Anything we could not place goes here verbatim (lossless safety net) ----
    var leftovers = [];
    if (sec.__pre && bodyText(sec.__pre).trim()) leftovers.push(bodyText(sec.__pre));
    p.unmatched.forEach(function (u) {
      if (u.__consumed) return;
      var b = bodyText(u.body);
      leftovers.push(u.h + ':' + (b ? ('\n' + b) : ''));
    });
    if (leftovers.length) {
      out.push('ADDITIONAL DOCUMENTATION:');
      out.push(leftovers.join('\n\n'));
      out.push('');
    }

    // collapse 3+ blank lines to 1
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  }

  // Heuristic: does this text already look like a normalized professional op note?
  function isNormalized(text) {
    var t = String(text || '');
    var n = 0; CANON.forEach(function (k) { if (t.indexOf(k + ':') >= 0 || t.indexOf(k) >= 0) n++; });
    return n >= 7 && /OPERATIVE \/ PROCEDURE NOTE/.test(t);
  }

  /* =============================================================
     PART 2 — PDF EXPORT (real text, headings, letterhead, margins)
     ============================================================= */
  function ensureJsPdf() {
    if (typeof window.loadJsPdf === 'function') return window.loadJsPdf();
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
    return new Promise(function (resolve, reject) {
      var ex = document.getElementById('jspdfScript');
      var ok = function () { (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf) : reject(new Error('jsPDF unavailable')); };
      if (ex) { ex.addEventListener('load', ok); ex.addEventListener('error', function () { reject(new Error('jsPDF load error')); }); return; }
      var s = document.createElement('script');
      s.id = 'jspdfScript';
      s.src = 'vendor/jspdf.umd-4.2.1.min.js?v=e6551fcdc32f09d6';
      s.onload = ok; s.onerror = function () { reject(new Error('jsPDF load error')); };
      document.head.appendChild(s);
    });
  }

  function slug(s) {
    return String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'patient';
  }
  function dateForFile(dop) {
    var d = dop ? new Date(dop) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
  }
  // jsPDF's standard-14 fonts are Latin-1 only; strip anything that won't render.
  function pdfSafe(s) {
    return String(s == null ? '' : s)
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„]/g, '"')
      .replace(/[–—−]/g, '-')
      .replace(/…/g, '...')
      .replace(/[•●▪·]/g, '-')
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
  }

  function isHeadingLine(line) {
    var t = String(line || '').replace(/\s*:\s*$/, '').trim();
    if (!t || t.length > 60) return false;
    if (/[a-z]/.test(t)) return false;
    if (!/[A-Z]/.test(t)) return false;
    return /:\s*$/.test(line) || (!/[.;]/.test(t));
  }
  function isSubLabelLine(line) {
    var m = String(line || '').match(/^([A-Za-z][A-Za-z /&()'.\-]{0,40}?):\s+\S/);
    return m ? m[1] : null;
  }

  async function exportPdf(rawText, opts) {
    opts = opts || {};
    var meta = appMeta();
    if (opts.patient) meta.patient = opts.patient;
    var pro = isNormalized(rawText) ? String(rawText) : normalize(rawText, meta);

    var ns;
    try { ns = await ensureJsPdf(); }
    catch (e) { safe(function () { toast('Could not load the PDF engine — check your connection.', 'err'); }); return false; }
    var jsPDF = ns.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 56, maxW = pageW - margin * 2, lineH = 14;
    var y = margin;

    var lh = window.MLS_OPNOTE_LETTERHEAD || {};
    var docName = meta.provider || 'Clinician';
    var spec = meta.spec || '';
    var printed = new Date().toLocaleString();

    function footer() {
      var pc = doc.internal.getNumberOfPages();
      for (var i = 1; i <= pc; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
        doc.text('Page ' + i + ' of ' + pc, pageW - margin, pageH - 24, { align: 'right' });
        doc.text('Generated with MLS — review and complete any [bracketed] items before signing.', margin, pageH - 24);
      }
      doc.setTextColor(0);
    }
    function ensure(h) { if (y + (h || 0) > pageH - margin - 28) { doc.addPage(); y = margin; } }
    function write(txt, fs, bold, color) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(fs);
      if (color) doc.setTextColor(color[0], color[1], color[2]); else doc.setTextColor(20, 34, 48);
      var lines = doc.splitTextToSize(pdfSafe(txt), maxW);
      for (var i = 0; i < lines.length; i++) { ensure(lineH); doc.text(lines[i], margin, y); y += lineH; }
    }

    // ---- Letterhead ----
    if (lh.clinicName) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(21, 95, 179);
      doc.text(pdfSafe(lh.clinicName), margin, y); y += 18;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
      (lh.addressLines || []).forEach(function (a) { doc.text(pdfSafe(a), margin, y); y += 12; });
    } else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(21, 95, 179);
      doc.text('MLS', margin, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
      doc.text(spec || 'Physical Medicine & Rehabilitation', margin + 42, y); y += 16;
    }
    // provider + date header line (right-aligned)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
    doc.text(pdfSafe('Provider: ' + docName + (spec && lh.clinicName ? (' · ' + spec) : '')), pageW - margin, margin, { align: 'right' });
    doc.text(pdfSafe('Printed: ' + printed), pageW - margin, margin + 12, { align: 'right' });
    y = Math.max(y, margin + 26);
    doc.setDrawColor(31, 122, 224); doc.setLineWidth(1.2); doc.line(margin, y, pageW - margin, y); y += 18;

    // ---- Title ----
    doc.setTextColor(21, 95, 179); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    ensure(lineH); doc.text('OPERATIVE / PROCEDURE NOTE', margin, y); y += 20;

    // ---- Body: render the normalized text with heading hierarchy ----
    var bodyLines = pro.split('\n');
    // skip the title we already printed
    var started = false;
    for (var i = 0; i < bodyLines.length; i++) {
      var line = bodyLines[i];
      if (!started) {
        if (/OPERATIVE \/ PROCEDURE NOTE/.test(line)) { started = true; continue; }
      }
      if (!line.trim()) { y += lineH * 0.5; continue; }
      if (isHeadingLine(line)) {
        y += 4; ensure(lineH + 6);
        write(stripColon(line), 11, true, [21, 95, 179]);
        doc.setDrawColor(225, 233, 241); doc.setLineWidth(0.5);
        doc.line(margin, y - lineH + 3, pageW - margin, y - lineH + 3);
        continue;
      }
      var subLab = isSubLabelLine(line);
      if (subLab && /^(Patient|DOB|MRN|Date of Procedure|Provider|Assistant)$/i.test(subLab)) {
        write(line, 10.5, true);
        continue;
      }
      // bullet / numbered / plain body
      write(line, 10.5, false);
    }

    footer();
    var fname = 'OpNote_' + slug(meta.patient) + '_' + dateForFile(meta.dop) + '.pdf';
    try { doc.save(fname); } catch (e) { safe(function () { toast('Could not save the PDF.', 'err'); }); return false; }
    safe(function () { toast('Saved ' + fname, 'ok'); });
    return true;
  }
  // expose for buttons (avoids inline-handler scope issues)
  window.__mlsOpNotePdf = function (getText, patient) {
    var t = (typeof getText === 'function') ? getText() : getText;
    if (!t || !String(t).trim()) { safe(function () { toast('Generate the op note first.', 'err'); }); return; }
    /* Fail-closed export gate: a note with ANY unresolved placeholder is a
       DRAFT — it can be reviewed on screen but never leaves the app as a
       finished PDF. One canonical parser decides (same as save/routing). */
    try {
      if (typeof window.opNoteBlankTokens === 'function') {
        var unresolved = window.opNoteBlankTokens(String(t));
        if (unresolved.length) {
          var labels = unresolved.map(function (x) { return x.label || x.key; });
          var shown = labels.slice(0, 6).join(', ') + (labels.length > 6 ? (' +' + (labels.length - 6) + ' more') : '');
          safe(function () { toast('This op note is still a draft — ' + unresolved.length + ' unresolved field' + (unresolved.length === 1 ? '' : 's') + ' (' + shown + '). Fill them in before exporting a PDF.', 'err'); });
          return;
        }
      }
    } catch (eGuard) {}
    exportPdf(String(t), { patient: patient });
  };

  /* =============================================================
     WIRING — buttons + generation wraps
     ============================================================= */
  function injectCss() {
    if (document.getElementById('mlsOpProCss')) return;
    var st = document.createElement('style'); st.id = 'mlsOpProCss';
    st.textContent =
      '.mlsop-pdf{font:inherit;font-size:13px;cursor:pointer;border:1px solid #2E6A4B;background:#2E6A4B;color:#fff;' +
      'border-radius:8px;padding:6px 12px;font-weight:600;display:inline-flex;align-items:center;gap:5px}' +
      '.mlsop-pdf:hover{background:#2E6A4B;border-color:#2E6A4B}' +
      '.mlsop-pdf:disabled{opacity:.6;cursor:default}';
    (document.head || document.documentElement).appendChild(st);
  }

  function mkPdfBtn(label) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'mlsop-pdf btn-ghost'; b.textContent = label || '🧾 Save as PDF';
    b.setAttribute('data-mlsop', '1');
    return b;
  }

  // (A) Procedure-Note builder bar (#procResultWrap) — next to Copy / Print.
  function wireProcBuilder() {
    var wrap = document.getElementById('procResultWrap');
    if (!wrap) return;
    var bar = wrap.querySelector('.row.tight') || wrap.querySelector('.row') || wrap;
    if (bar.querySelector('[data-mlsop]')) return;
    var btn = mkPdfBtn('🧾 Save as PDF');
    btn.addEventListener('click', function () {
      var ta = document.getElementById('procNoteBody');
      window.__mlsOpNotePdf(function () { return ta ? ta.value : ''; });
    });
    bar.appendChild(btn);
  }

  // (B) History op-note viewer modal (#viewModal) — add a Save-as-PDF when an op note is shown.
  function wireHistoryViewer() {
    var modal = document.getElementById('viewModal');
    if (!modal) return;
    var body = document.getElementById('viewBody');
    var meta = document.getElementById('viewMeta');
    if (!body || !meta) return;
    // place the button in the modal's footer/action row if we can find one, else after the body
    var host = modal.querySelector('.modal-foot') || modal.querySelector('.row') || body.parentNode;
    if (!host) return;
    if (host.querySelector('[data-mlsop]')) { return; }
    var btn = mkPdfBtn('🧾 Save as PDF');
    btn.style.display = 'none';
    btn.addEventListener('click', function () {
      window.__mlsOpNotePdf(function () { return body.value; }, (document.getElementById('viewTitle') || {}).textContent);
    });
    host.appendChild(btn);
    // show/hide depending on whether the open note is an operative note
    function refresh() {
      /* completed op notes only — a "(draft)" viewer never offers PDF export */
      var isOp = /operative note/i.test(meta.textContent || '') && !/\(draft\)/i.test(meta.textContent || '');
      btn.style.display = (modal.classList.contains('show') && isOp) ? 'inline-flex' : 'none';
    }
    safe(function () {
      var mo = new MutationObserver(refresh);
      mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
      mo.observe(meta, { childList: true, characterData: true, subtree: true });
    });
    refresh();
  }

  // (C) Prep-op-note rows (opPrepNote_<i>) — add a per-row Save-as-PDF after generation.
  function wirePrepRows() {
    var nodes = document.querySelectorAll('textarea[id^="opPrepNote_"]');
    Array.prototype.forEach.call(nodes, function (ta) {
      if (ta.__mlsopBtn) return;
      ta.__mlsopBtn = true;
      var row = ta.parentNode; if (!row) return;
      var btn = mkPdfBtn('🧾 PDF');
      btn.style.marginTop = '6px';
      btn.addEventListener('click', function () {
        var nm = '';
        safe(function () { var i = ta.id.split('_')[1]; var r = (window._opPrep || [])[i]; nm = r && r.appt && r.appt.name; });
        window.__mlsOpNotePdf(function () { return ta.value; }, nm);
      });
      // insert right after the textarea
      if (ta.nextSibling) row.insertBefore(btn, ta.nextSibling); else row.appendChild(btn);
    });
  }

  /* ---- PART 1 generation wraps ---- */

  // Wrap the deterministic injection-note builder so its output lands in the
  // full professional format. Keeps the original; on any error the original
  // output is left untouched.
  function wrapGenerateProcNote() {
    if (typeof window.generateProcNote !== 'function' || window.generateProcNote.__mlsopWrapped) return;
    var orig = window.generateProcNote;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try {
        var ta = document.getElementById('procNoteBody');
        if (ta && ta.value && ta.value.trim() && !isNormalized(ta.value)) {
          var pro = normalize(ta.value, appMeta());
          if (pro && pro.trim()) {
            ta.value = pro;
            try { if (window.__mlsFormat && window.__mlsFormat.rerender) window.__mlsFormat.rerender(); } catch (e) {}
            // keep the app's in-memory copy in sync if it tracks this
            try { if (typeof currentProcNote !== 'undefined') currentProcNote = ta.value; } catch (e) {}
          }
        }
      } catch (e) { /* leave original output */ }
      return r;
    };
    wrapped.__mlsopWrapped = true;
    try { window.generateProcNote = wrapped; } catch (e) {}
  }

  // Enhanced system prompt for the AI template-adapt path. Enforces the full
  // professional structure + no-fabrication discipline while still following
  // the doctor's uploaded template.  Re-implements _genOpNote with the SAME
  // input/output contract ({note, missing}) so the Prep flow's blank-filler is
  // unaffected; falls back to the original on ANY error.
  function wrapGenOpNote() {
    if (typeof window._genOpNote !== 'function' || window._genOpNote.__mlsopWrapped) return;
    var orig = window._genOpNote;
    var enhanced = async function (name, dateStr, procedure, tplText, ctx) {
      try {
        if (typeof window.aiCallRaw !== 'function') return await orig(name, dateStr, procedure, tplText, ctx);
        ctx = ctx || {};
        var exactPatient = (typeof window._opResolvePatient === 'function') ? window._opResolvePatient(name, ctx.dob, ctx.patientId) : null;
        if (!exactPatient || !String(ctx.patientId || '').trim() || String(exactPatient.id || '') !== String(ctx.patientId || '')) {
          var identityErr = new Error('Op-note generation stopped: exact patient identity could not be verified.');
          identityErr.code = 'MLS_OPNOTE_IDENTITY'; throw identityErr;
        }
        name = String(exactPatient.name || name || '');
        ctx.dob = String(exactPatient.dob || ''); ctx.sex = String(exactPatient.sex || exactPatient.gender || '');
        ctx.age = (typeof window._ptAge === 'function') ? window._ptAge(exactPatient.dob) : ctx.age;
        ctx.bmi = (typeof window._ptBmi === 'function') ? window._ptBmi(exactPatient) : ctx.bmi;
        ctx.mrn = String(exactPatient.mrn || '');
        var known = [];
        if (name) known.push('name: ' + name);
        if (ctx.sex) known.push('sex: ' + ctx.sex);
        if (ctx.dob) known.push('date of birth: ' + ctx.dob);
        if (ctx.age != null) known.push('age: ' + ctx.age);
        if (ctx.bmi != null) known.push('BMI: ' + ctx.bmi);
        if (ctx.mrn) known.push('MRN: ' + ctx.mrn);
        var sys = 'You draft an OPERATIVE / PROCEDURE NOTE for a pain/spine physician by adapting ONE of their OWN prior operative notes (the TEMPLATE) to a new patient and procedure. '
          + 'Produce a COMPLETE, professional operative note — never a summary. Follow the template\'s wording and style, but ensure the finished note is organized under clear ALL-CAPS section headers, each on its own line, in this order: '
          + 'PREOPERATIVE DIAGNOSIS; POSTOPERATIVE DIAGNOSIS; PROCEDURE(S) PERFORMED (with CPT code if the template/known facts support it); ANESTHESIA; INDICATIONS FOR PROCEDURE; CONSENT; FINDINGS; DESCRIPTION OF PROCEDURE (detailed, step-by-step technique appropriate to the specific procedure — positioning, prep/drape, imaging guidance, needle type/approach/level, contrast confirmation, medication injected with dose, needle withdrawal, etc.); ESTIMATED BLOOD LOSS; COMPLICATIONS; SPECIMENS; DISPOSITION / POST-PROCEDURE PLAN; DIAGNOSIS CODES (ICD-10); PROCEDURE CODES (CPT). '
          + 'If the template already contains a section, keep its content; ADD any missing heading from the list above. '
          + 'CRITICAL — the KNOWN PATIENT FACTS below are already in our chart: fill each one directly into the note wherever needed, and NEVER list any known fact in "missing". NEVER ask for patient name, sex/gender, age, date of birth, MRN, or BMI. '
          + 'NEVER invent or assume clinical facts (diagnoses, findings, blood loss, specimens, anesthesia, codes, etc.). If a section is not supported by the template, the procedure, or the known facts, write exactly "[not dictated]" for that section rather than fabricating. '
          + 'Use the [[key]] placeholder (and a matching "missing" entry) ONLY for a per-case detail that genuinely varies AND is not known — e.g. needle gauge/size, medication name/dose/volume, contrast amount, fluoroscopy time, sedation, or an ambiguous level. Be conservative — use the FEWEST placeholders possible; if the template states a standard value, keep it. Each placeholder key must be UNIQUE, snake_case, and appear exactly once. '
          + 'CODING -- fill real codes, never echo an instruction: when the TEMPLATE, transcript, or KNOWN FACTS name a specific diagnosis or procedure -- INCLUDING a template line that itself asks for a code (e.g. "ICD-10 code for facet-mediated lumbar pain" or "CPT code for lumbar medial branch block") -- REPLACE that text with the correct, current, fully-specified, billable ICD-10 or CPT code for that named diagnosis/procedure, followed by a short description. Coding an explicitly-stated diagnosis is expected, NOT fabrication; do NOT output a truncated or deprecated parent code that is not separately billable, and do NOT invent a code for a diagnosis that was not stated. NEVER leave literal "ICD-10 code for ..." or "CPT code for ..." text in the finished note. Fill the DIAGNOSIS CODES (ICD-10) and PROCEDURE CODES (CPT) sections with the real codes. Only if genuinely unsure of the exact current code for a named diagnosis, insert a [[icd10_<short_dx>]] placeholder and add it to the "missing" list instead of guessing. ACCURACY -- pick the MOST SPECIFIC CURRENT code, never a deprecated or generic symptom/parent code: for facet-mediated pain, facet arthropathy, or spondylosis use the region-specific spondylosis-without-myelopathy code (lumbar M47.816, cervical M47.812, thoracic M47.814), not a generic low-back-pain code; the old low-back-pain code M54.5 is NO LONGER billable (it was split into M54.50 unspecified, M54.51 vertebrogenic, M54.59 other) so never output a bare M54.5. You DO reliably know the correct standard ICD-10 and CPT codes for common, well-established diagnoses and procedures -- provide those confidently by default; reserve the placeholder/verify path ONLY for genuinely uncommon or ambiguous cases where the exact current code is truly uncertain, never as a default. '
          + 'Return ONLY JSON, no prose, no code fence: {"note":"<full operative note text with ALL-CAPS headings and [[key]] placeholders where needed>","missing":[{"key":"needle_size","label":"Needle size / gauge","example":"22g 3.5in"}]}.';
        var user = 'PATIENT: ' + name + '\nDATE OF PROCEDURE: ' + dateStr + '\nPROCEDURE: ' + procedure
          + (known.length ? ('\n\nKNOWN PATIENT FACTS (already in our chart — fill these in, do NOT ask for them):\n- ' + known.join('\n- ')) : '')
          + '\n\nTEMPLATE (the doctor\'s own prior op note — match its structure & style, expand to the full professional format above):\n' + String(tplText || '').slice(0, 9000);
        var key = (typeof getKey === 'function') ? getKey() : '';
        var raw = await window.aiCallRaw(sys, user, key, { freeform: true, mlsOpNotePatientId: String(exactPatient.id) });
        var s = String(raw || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        var obj = null;
        try { obj = JSON.parse(s); } catch (e) { try { var m = s.match(/\{[\s\S]*\}/); if (m) obj = JSON.parse(m[0]); } catch (_) {} }
        if (!obj || typeof obj !== 'object') return { note: s, missing: [] };
        return { note: String(obj.note || ''), missing: Array.isArray(obj.missing) ? obj.missing : [] };
      } catch (e) {
        if (e && e.code === 'MLS_OPNOTE_IDENTITY') throw e;
        try { return await orig(name, dateStr, procedure, tplText, ctx); } catch (e2) { if (e2 && e2.code === 'MLS_OPNOTE_IDENTITY') throw e2; return { note: '', missing: [] }; }
      }
    };
    enhanced.__mlsopWrapped = true;
    try { window._genOpNote = enhanced; } catch (e) {}
  }

  function wire() {
    safe(injectCss);
    safe(wireProcBuilder);
    safe(wireHistoryViewer);
    safe(wirePrepRows);
    safe(wrapGenerateProcNote);
    safe(wrapGenOpNote);
  }

  window.__mlsOpNotePro = {
    version: '1.0.0',
    normalize: normalize,
    parseNote: parseNote,
    isNormalized: isNormalized,
    exportPdf: exportPdf,
    rewire: function () { safe(wire); }
  };

  function boot() { safe(wire); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // re-wire as views mount (op-note panels appear after login / view switch / generate)
  var n = 0; var iv = setInterval(function () { n++; if (n > 60) { clearInterval(iv); return; } safe(wire); }, 1000);
})();
