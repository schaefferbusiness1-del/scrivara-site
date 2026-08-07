/* =============================================================================
 * feat_mls_opnote_daybrain.js  ->  window.__mlsOpNoteDayBrain   (opdb-1.0.0)
 * -----------------------------------------------------------------------------
 * OWNER REQUEST (2026-08-07, verbatim): "the auto match is not perfect and it
 * needs to be it should use AI not just key words. Also the op notes should
 * connect with history and visit smartly so like if a patient on a day did not
 * do an injection it should not auto write an op note for them unless literally
 * the doctor bypasses it ... It should be draft day but then only show people
 * who got injection and need op note also if ai is not sure about which
 * template to use auto match and give best options based on auto match and then
 * only after that the whole list of all op notes should be there"
 *
 * FOUR DELIVERABLES, and the seam each one uses:
 *
 *   D1  AI-ASSISTED MATCHING. feat_mls_opnote_integrity.js (oni) owns
 *       _opRankTemplates/_opBestTemplate and its deterministic ranker is the
 *       product of b936-b940 (level tokens, abbreviation expansion, class
 *       clashes, ESI-family fences). NONE of that is replaced. oni still
 *       decides; the model is consulted ONLY on the rows oni itself declines to
 *       call confident, and only to choose AMONG oni's own compatible
 *       candidates. The model can never introduce a template oni did not rank,
 *       never overturn a safety refusal, and never narrow within a family.
 *
 *   D2  DAY TRIAGE. opPrepGenerateAll drafted `for(i=0;i<rows.length;i++)` -
 *       every scheduled patient, unconditionally. A Tuesday follow-up, a
 *       cancelled slot and a med-check all got an operative note written for a
 *       procedure that never happened. Rows are now triaged, and only the
 *       `needs` set is drafted.
 *
 *   D3  DRAFT DAY. The list leads with the patients who actually need an op
 *       note; everyone else is folded behind one line and stays one click away.
 *
 *   D4  BEST OPTIONS FIRST. When neither oni nor the model is confident,
 *       nothing is auto-applied: the top ranked candidates are offered as
 *       one-click chips, and the existing full dropdown of every template stays
 *       exactly where it was, underneath them.
 *
 * WHAT THIS FILE MAY NOT DO (measured contracts, not preferences):
 *   - It never edits a row card's structure. `#opPrepList > div` is the card
 *     (feat_mls_opnote_templates_ui.js:347) and two positional lookups run over
 *     it: feat_mls_opnote_fill.js:1478 keeps the fill box in
 *     `#opPrepNote_i.previousElementSibling`, and oni:580 reads the match badge
 *     from `#opPrepTpl_i.parentElement`'s FIRST `span.mini span`. Everything
 *     this module injects goes (a) as the card's first child, or (b) as a
 *     sibling BEFORE the template row - never into either of those two slots.
 *   - It never reorders window._opPrep. Every id in the surface is the array
 *     index (opPrepNote_3 is rows[3]); a sort would repoint in-flight drafts at
 *     other patients. Ordering is presentational, via CSS `order`.
 *   - It wraps; it does not replace. oni, opnp and the room all wrap the same
 *     globals, so this module installs OUTERMOST and calls through.
 *
 * Additive + reversible (window.__mlsOpNoteDayBrain.revert()). ES5 syntax
 * throughout (no arrow / let / const / template literal / async-await) to match
 * opnp and oni; Promise is used, as oni already does, because the AI hop is
 * asynchronous by nature.
 * ===========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsOpNoteDayBrain && window.__mlsOpNoteDayBrain.installed) return; } catch (e) { return; }

  var VERSION = 'opdb-1.0.0';
  var STYLE_ID = 'mlsOpdbCss';

  function S(x) { return x == null ? '' : String(x); }
  function isFn(f) { return typeof f === 'function'; }
  function trim(x) { return S(x).replace(/^\s+|\s+$/g, ''); }
  function low(x) { return trim(x).toLowerCase(); }
  function esc(s) {
    return S(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function oni() { try { return window.__mlsOpNoteIntegrity || null; } catch (e) { return null; } }
  function say(msg, kind) { try { if (isFn(window.toast)) window.toast(msg, kind || ''); } catch (e) {} }

  /* ===========================================================================
   * (1) DID THIS PATIENT ACTUALLY HAVE A PROCEDURE?
   *
   * HONEST LIMITS OF THE AVAILABLE SIGNALS - this determines the whole design,
   * so it is written down rather than assumed:
   *
   *   appointment.status EXISTS and is a real enum
   *   ('booked'|'checked_in'|'roomed'|'completed'|'cancelled'|'no_show';
   *   scrivara-backend/src/server.js:2519 whitelists exactly these). BUT the
   *   same line defaults ANY unrecognised value to 'booked', and the Athena
   *   study importer (mls-connect.js buildApptForRow) sends no status at all.
   *   So on a real pulled day nearly every row reads 'booked' whether the
   *   injection happened or not.
   *
   *   THEREFORE: 'booked' is treated as NO INFORMATION, never as evidence that
   *   a procedure did not happen. Holding a row back on 'booked' would hide the
   *   entire day on every Athena-pulled schedule - the opposite of the ask.
   *   Only the two unambiguous negatives ('cancelled', 'no_show') hold a row,
   *   and the three positives ('completed','checked_in','roomed') are shown as
   *   confirmation.
   *
   * The load-bearing signal is therefore WHAT THE VISIT IS: a scheduled
   * "Routine follow-up", "New patient consult", "Post-op check" or "Medication
   * management" is not an injection and never needed an operative note. That is
   * exactly the owner's case ("if a patient on a day did not do an injection"),
   * and unlike status it is present on every row of every real schedule.
   * ======================================================================== */

  var NEGATIVE_STATUS = { cancelled: 1, canceled: 1, no_show: 1, noshow: 1, 'no-show': 1 };
  var PERFORMED_STATUS = { completed: 1, checked_in: 1, roomed: 1, arrived: 1, fulfilled: 1 };

  /* An explicit procedure word, for the terse real-schedule spellings whose
     class oni cannot name ("R knee injection", "caudal", "lysis of adhesions").
     Deliberately NOT a general clinical vocabulary: every entry here is an
     operation someone would write an operative note for. */
  var PROC_WORD = new RegExp(
    '\\b(' +
    'injection|inject|injections|block|blocks|ablation|rfa|rhizotomy|neurotomy|denervation|' +
    'epidural|esi|tfesi|ilesi|mbb|medial\\s*branch|facet|discogram|discography|' +
    'kyphoplasty|vertebroplasty|intracept|basivertebral|bvn|' +
    'stimulator|scs|trial\\s*lead|implant|explant|revision|' +
    'lysis\\s*of\\s*adhesion|adhesiolysis|myelogram|arthrogram|' +
    'bursa|bursal|trigger\\s*point|tpi|genicular|sacroiliac|si\\s*joint|' +
    'sympathetic|ganglion|stellate|celiac|hypogastric|' +
    'nerve\\s*root|selective\\s*nerve|aspiration|arthrocentesis|' +
    'pump\\s*refill|intrathecal|radiofrequency|cryo(?:ablation|neurolysis)|' +
    'prp|platelet\\s*rich|viscosupplement|hyaluronic' +
    ')\\b', 'i');

  /* Visit types that are explicitly NOT procedures. Checked only to explain the
     hold in words the doctor recognises - the verdict itself comes from the
     absence of procedure evidence, so an unlisted phrasing still holds. */
  var NON_PROC_WORD = new RegExp(
    '\\b(' +
    'follow[\\s-]?up|f\\/u|recheck|re[\\s-]?check|consult(?:ation)?|new\\s*patient|' +
    'office\\s*visit|established\\s*patient|med(?:ication)?\\s*(?:check|management|refill)|' +
    'post[\\s-]?op(?:erative)?\\s*(?:check|visit)|pre[\\s-]?op(?:erative)?\\s*(?:clearance|visit)|' +
    'telehealth|telephone|nurse\\s*visit|lab|imaging\\s*review|mri\\s*review|results|' +
    'evaluation|eval\\b|assessment|physical|annual|wellness|dme|paperwork|discussion' +
    ')\\b', 'i');

  function todayKey() {
    try { if (isFn(window._acctTodayKey)) return S(window._acctTodayKey()); } catch (e) {}
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function dayIsFuture(dateKey) { var k = S(dateKey); return !!k && k > todayKey(); }

  /* Does the app hold ANY real status information for this day? If every row
     reads 'booked' the status column is uninformative (see the note above) and
     must not be allowed to speak. */
  function dayHasStatusSignal(dateKey) {
    try {
      var rows = window._calAppts || [], seen = false;
      for (var i = 0; i < rows.length; i++) {
        var a = rows[i]; if (!a) continue;
        if (S(a.appt_date || S(a.start_at).slice(0, 10)) !== S(dateKey)) continue;
        var st = low(a.status);
        if (st && st !== 'booked') { seen = true; break; }
      }
      return seen;
    } catch (e) { return false; }
  }

  /* The calendar appointment behind a row. _opApptsForDay (ScribeFlow.html:16250)
     PROJECTS AWAY status, checked_in_at and id - row.appt is a fresh object that
     never carried them - so the original is re-joined here by immutable external
     id first, then by name within the same day. */
  function apptFor(row) {
    try {
      if (!row) return null;
      var want = trim(row.patientId || (row.appt && row.appt.patientId));
      var wantName = low(row.appt && row.appt.name).replace(/\s+/g, ' ');
      var key = S(row.dateKey);
      var rows = window._calAppts || [], byName = null;
      for (var i = 0; i < rows.length; i++) {
        var a = rows[i]; if (!a) continue;
        if (key && S(a.appt_date || S(a.start_at).slice(0, 10)) !== key) continue;
        var aid = trim(a.patient_external_id || a._mlsTargetPatientId || a.patientId);
        if (want && aid && aid === want) return a;
        var nm = low(a.name || (isFn(window._calLabelOf) ? window._calLabelOf(a) : '')).replace(/\s+/g, ' ');
        if (wantName && nm === wantName && !byName) byName = a;
      }
      /* Name-only is a fallback, never an override: an id match always wins. */
      return byName;
    } catch (e) { return null; }
  }
  function statusForRow(row) {
    var direct = low(row && row.appt && row.appt.status);
    if (direct) return direct;
    var a = apptFor(row);
    return a ? low(a.status) : '';
  }

  /* POSITIVE evidence the visit happened, in the two forms this app actually
     records. Both are stronger than `status` on an Athena-pulled day, where
     status is always 'booked' because background.js strips the status words out
     of the scraped row (6344/6841/6452) and the import body never carries one.
       1. appointment.checked_in_at - set by the in-app check-in (server.js:6035)
       2. a real, non-draft saved note for that patient dated that day - the same
          rule _seenToday (ScribeFlow.html:20010) uses for "seen", generalised
          off today so a past day can be read too.
     Absence of both is NOT evidence the visit did not happen, and is never used
     to hold a row back. */
  function checkedInAtFor(row) {
    var a = apptFor(row);
    return a ? trim(a.checked_in_at) : '';
  }
  function dayKeyOfNote(n) {
    try {
      var d = new Date((n && (n.updated || n.created)) || 0);
      if (isNaN(d.getTime())) return '';
      if (isFn(window._acctDateKeyOf)) return S(window._acctDateKeyOf(d));
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    } catch (e) { return ''; }
  }
  function seenOnDay(row) {
    try {
      if (!row || !isFn(window.getNotes) || !isFn(window._opResolvePatient)) return false;
      var key = S(row.dateKey); if (!key) return false;
      var p = window._opResolvePatient(row.appt && row.appt.name, row.appt && row.appt.dob, row.patientId);
      if (!p || !trim(p.id)) return false;
      var ns = notesNow();
      for (var i = 0; i < ns.length; i++) {
        var n = ns[i];
        if (!n || n.isDraft) continue;
        if (S(n.patientId) !== S(p.id)) continue;
        if (dayKeyOfNote(n) === key) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  /* Procedure evidence in the scheduled reason. Stricter than oni's
     hasProcedureSignal, which counts a bare region or side - "right knee pain"
     has a side and is not an operation. */
  function procedureEvidenceOf(text) {
    var t = trim(text);
    var out = { has: false, type: '', why: '' };
    if (!t) { out.why = 'the schedule has no procedure text for this visit'; return out; }
    var o = oni();
    if (o && isFn(o.statesNoProcedure) && o.statesNoProcedure(t)) {
      out.why = 'the visit text says no procedure was performed';
      return out;
    }
    var facts = null;
    try { if (o && isFn(o.parseProcedureFacts)) facts = o.parseProcedureFacts(t); } catch (e) { facts = null; }
    if (facts && (facts.procedureType || facts.approach || facts.levelCount > 0)) {
      out.has = true; out.type = S(facts.procedureType); return out;
    }
    if (PROC_WORD.test(t)) { out.has = true; return out; }
    out.why = NON_PROC_WORD.test(t)
      ? 'this is scheduled as ' + shortReason(t) + ', not a procedure'
      : '"' + shortReason(t) + '" does not name a procedure';
    return out;
  }
  function shortReason(t) { t = trim(t); return t.length > 46 ? (t.slice(0, 46) + '…') : t; }

  /* Direct-child lookup by class. `:scope >` would be shorter and is the thing
     that breaks first in a reduced DOM (the contract suites execute this file
     against a stub), so the children are walked instead. */
  function ownChild(parent, cls) {
    if (!parent) return null;
    var kids = parent.children || [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c && c.classList && c.classList.contains(cls)) return c;
    }
    return null;
  }

  /* getNotes() is an UNMEMOIZED JSON.parse of the whole notes store
     (ScribeFlow.html:9118), and triage asks for it up to twice per row -
     existingOpNote and seenOnDay. triageAll() runs over every row on every
     opPrepRender(), and a draft-all calls opPrepRender() once per drafted
     patient, so an 18-row day was heading for ~650 full parses of the store on
     the main thread. Parsed ONCE per triage pass instead; the cache lives only
     for the duration of that pass, so a note saved mid-day is still seen by the
     next one. */
  var notesPass = null;
  function notesNow() {
    if (notesPass) return notesPass;
    try { return (isFn(window.getNotes) ? window.getNotes() : []) || []; } catch (e) { return []; }
  }

  /* An operative note already in the chart for this patient + this procedure.
     Same ownership rule the resume path uses (feat_mls_opnote_prep.js:341):
     kind 'opnote', matched by immutable patient id and procedure containment. */
  function existingOpNote(row) {
    try {
      if (!row || !isFn(window.getNotes)) return null;
      var p = isFn(window._opResolvePatient)
        ? window._opResolvePatient(row.appt && row.appt.name, row.appt && row.appt.dob, row.patientId) : null;
      if (!p || !trim(p.id)) return null;
      var proc = trim(row.proc || (row.appt && row.appt.reason));
      var ns = notesNow(), best = null;
      for (var i = 0; i < ns.length; i++) {
        var n = ns[i];
        if (!n || S(n.patientId) !== S(p.id) || S(n.kind) !== 'opnote') continue;
        if (proc && S(n.cc).indexOf(proc) < 0) continue;
        if (!best || (+n.updated || 0) > (+best.updated || 0)) best = n;
      }
      return best;
    } catch (e) { return null; }
  }

  /* THE VERDICT.
     'needs' - draft it (this is the only set "Draft all" touches)
     'held'  - do not draft without an explicit click; the reason is shown
     'done'  - an op note is already signed/saved for this procedure          */
  function triage(row) {
    if (!row) return { verdict: 'held', code: 'no-row', why: 'no appointment' };
    if (row._opdbBypass) return { verdict: 'needs', code: 'bypass', why: 'You chose to draft this one.' };

    var proc = S(row.proc || (row.appt && row.appt.reason));
    var st = statusForRow(row);

    if (NEGATIVE_STATUS[st]) {
      return { verdict: 'held', code: st === 'cancelled' || st === 'canceled' ? 'cancelled' : 'no-show',
        why: (st === 'cancelled' || st === 'canceled')
          ? 'the appointment was cancelled — no procedure was performed'
          : 'the patient did not show — no procedure was performed', status: st };
    }

    var ev = procedureEvidenceOf(proc);
    if (!ev.has) return { verdict: 'held', code: 'not-a-procedure', why: ev.why, status: st };

    var note = existingOpNote(row);
    if (note && !note.isDraft) {
      return { verdict: 'done', code: 'already-saved', why: 'an op note for this procedure is already saved to the chart', status: st, noteId: note.id };
    }

    var checkedIn = checkedInAtFor(row);
    var confirmed = !!PERFORMED_STATUS[st] || !!checkedIn || seenOnDay(row);

    /* A past or same-day row on a schedule that DOES carry real statuses, still
       sitting at 'booked' with no check-in and no note, was never seen. Gated on
       dayHasStatusSignal so a status-less Athena day - which is every pulled day,
       because the scrape strips status - can never be silently emptied. */
    if (!dayIsFuture(row.dateKey) && st === 'booked' && !confirmed && dayHasStatusSignal(row.dateKey)) {
      return { verdict: 'held', code: 'never-arrived', why: 'still booked on a day the board moved on — no check-in recorded', status: st };
    }

    return { verdict: 'needs', code: 'ok', why: '', status: st,
      confirmed: confirmed, checkedIn: !!checkedIn, resuming: !!(note && note.isDraft) };
  }

  function triageAll() {
    var rows = window._opPrep || [], out = [];
    try { notesPass = (isFn(window.getNotes) ? window.getNotes() : []) || []; } catch (e) { notesPass = []; }
    try {
      for (var i = 0; i < rows.length; i++) {
        var t = triage(rows[i]);
        try { rows[i]._opdbTriage = t; } catch (e2) {}
        out.push(t);
      }
    } finally { notesPass = null; }
    return out;
  }
  function needsIndexes() {
    var rows = window._opPrep || [], out = [];
    for (var i = 0; i < rows.length; i++) {
      var t = (rows[i] && rows[i]._opdbTriage) || triage(rows[i]);
      if (t.verdict === 'needs') out.push(i);
    }
    return out;
  }

  /* ===========================================================================
   * (2) AI-ASSISTED TEMPLATE MATCHING
   *
   * oni.best(proc) already returns everything a matcher needs:
   *   { tpl, candidate, confident, reason, score, margin, tie, ranked,
   *     noProcedure, multi, conflicts }
   * with ranked[] entries { tpl, score, procClass, tplClass, compatible,
   * conflicts, index }.
   *
   * The model is asked ONLY when oni is not confident, and only to order oni's
   * own compatible candidates. Three fences, each mirroring a property oni
   * already guarantees, so a model reply can never be worse than today:
   *   F1 safety refusals are never sent (noProcedure / multi-procedure);
   *   F2 candidates that would NARROW WITHIN A FAMILY are removed before the
   *      model sees them, so it cannot invent an approach the doctor did not
   *      state (the rule tests/closest-guess-never-invents-a-procedure.test.js
   *      exists to protect);
   *   F3 the reply must name an id from the list it was given.
   * ======================================================================== */

  var AI_MIN_CONFIDENCE = 0.72;   /* below this nothing is auto-applied */
  var AI_MAX_CANDIDATES = 6;
  var ESI_CHILD = { tfesi: 1, interlaminar_esi: 1, caudal_esi: 1 };

  function aiReady() {
    try { return isFn(window.aiCallRaw) && isFn(window.hasAI) && window.hasAI() === true; } catch (e) { return false; }
  }
  function aiKey() { try { return isFn(window.getKey) ? window.getKey() : ''; } catch (e) { return ''; } }

  /* F2: a candidate that resolves a family PARENT to one of its children is a
     narrowing. "Lumbar ESI" is transforaminal, interlaminar or caudal - three
     different needles - and choosing one asserts an approach nobody stated. */
  function isNarrowing(entry) {
    if (!entry) return false;
    return S(entry.procClass) === 'generic_esi' && !!ESI_CHILD[S(entry.tplClass)];
  }

  function candidatesFor(res) {
    var ranked = (res && res.ranked) || [], out = [];
    for (var i = 0; i < ranked.length && out.length < AI_MAX_CANDIDATES; i++) {
      var e = ranked[i];
      if (!e || !e.tpl) continue;
      if (e.compatible === false) continue;   /* oni already ruled it a clash */
      if (isNarrowing(e)) continue;           /* F2 */
      if (!(e.score > 0)) continue;
      out.push(e);
    }
    return out;
  }

  function candidateBlock(cands) {
    var lines = [];
    for (var i = 0; i < cands.length; i++) {
      var t = cands[i].tpl || {};
      var kw = [];
      try { kw = (t.keywords || []).slice(0, 10); } catch (e) { kw = []; }
      lines.push(
        '[' + (i + 1) + '] id=' + S(t.id) +
        '\n    name: ' + S(t.name) +
        (kw.length ? ('\n    keywords: ' + kw.join(', ')) : '') +
        '\n    excerpt: ' + S(t.text).replace(/\s+/g, ' ').slice(0, 320)
      );
    }
    return lines.join('\n');
  }

  var AI_SYS =
    'You match a scheduled procedure to one of a doctor\'s own operative-note templates.\n' +
    'You are given the scheduled procedure text and a NUMBERED list of candidate templates that a ' +
    'deterministic clinical matcher already ranked and already checked for compatibility.\n\n' +
    'RULES:\n' +
    '1. Choose ONLY from the candidate list. Never return an id that is not in it. Never invent a template.\n' +
    '2. The procedure TYPE is the identity of an operative note. A transforaminal epidural is not a facet ' +
    'block, an injection is not a radiofrequency ablation, and a hip is not a spine — whatever else matches.\n' +
    '3. NEVER narrow a general procedure to a specific approach the text does not state. If the text says ' +
    'only "lumbar ESI", do not choose transforaminal, interlaminar or caudal — return a low confidence instead.\n' +
    '4. Level and side (L4-L5, right, bilateral) break ties WITHIN a type. They never outrank the type.\n' +
    '5. If no candidate is the procedure named, or two candidates are equally defensible, return id null ' +
    'with a low confidence. Being unsure is a correct answer; the doctor is asked instead.\n' +
    '6. Judge only the text given. Do not assume a procedure that is not written there.\n\n' +
    'Return ONLY JSON, no prose, no code fence:\n' +
    '{"id":"<candidate id, or null>","confidence":<0.0-1.0>,"why":"<one short clause, max 12 words>",' +
    '"alternates":["<candidate id>","<candidate id>"]}';

  function parseAiReply(raw) {
    /* The tolerant shape used at feat_mls_opnote_integrity.js:1009 and
       ScribeFlow.html:16772 - fenced, prefixed or trailing prose all survive. */
    var s = S(raw).replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim(), obj = null;
    try { obj = JSON.parse(s); } catch (e) {
      try { var m = s.match(/\{[\s\S]*\}/); if (m) obj = JSON.parse(m[0]); } catch (e2) {}
    }
    if (!obj || typeof obj !== 'object') return null;
    var conf = Number(obj.confidence);
    return {
      id: obj.id == null ? '' : S(obj.id).trim(),
      confidence: (isFinite(conf) && conf >= 0 && conf <= 1) ? conf : 0,
      why: S(obj.why).slice(0, 120),
      alternates: Array.isArray(obj.alternates) ? obj.alternates.map(S) : []
    };
  }

  /* Ask the model to choose among oni's candidates. Resolves to null on ANY
     problem - no key, no candidates, network, malformed reply, or an id that is
     not in the list. A null answer means "the deterministic result stands". */
  function aiChoose(procText, cands, contextLine) {
    if (!aiReady() || !cands || cands.length < 2) return Promise.resolve(null);
    var user =
      'SCHEDULED PROCEDURE: ' + S(procText).replace(/\s+/g, ' ').slice(0, 400) + '\n' +
      (contextLine ? ('PRIOR VERIFIED HISTORY FOR THIS PATIENT: ' + S(contextLine).slice(0, 700) + '\n') : '') +
      '\nCANDIDATE TEMPLATES:\n' + candidateBlock(cands);
    var allowed = {};
    for (var i = 0; i < cands.length; i++) allowed[S(cands[i].tpl.id)] = cands[i];
    return Promise.resolve(window.aiCallRaw(AI_SYS, user, aiKey(), { freeform: true, maxTokens: 300 }))
      .then(function (raw) {
        var r = parseAiReply(raw);
        if (!r) return null;
        if (r.id && !allowed[r.id]) return null;               /* F3 */
        if (r.id && isNarrowing(allowed[r.id])) return null;   /* F2, belt and braces */
        var alts = [];
        for (var j = 0; j < r.alternates.length; j++) {
          var a = S(r.alternates[j]);
          if (allowed[a] && a !== r.id && alts.indexOf(a) < 0) alts.push(a);
        }
        r.alternates = alts;
        return r;
      })['catch'](function () { return null; });
  }

  /* Short, verified history line for the prompt. Reuses oni's own ownership
     rule - a visit that fails historyVisitBelongsTo is never quoted. */
  function historyLine(row) {
    try {
      var o = oni();
      if (!o || !isFn(o._verifiedHistoryVisits) || !isFn(window._opResolvePatient)) return '';
      var p = window._opResolvePatient(row.appt && row.appt.name, row.appt && row.appt.dob, row.patientId);
      if (!p) return '';
      var vs = o._verifiedHistoryVisits(p) || [];
      vs = vs.slice().sort(function (a, b) { return S(b && (b.date || b.created)).localeCompare(S(a && (a.date || a.created))); });
      var parts = [];
      for (var i = 0; i < Math.min(3, vs.length); i++) {
        var v = vs[i] || {};
        var bit = trim(S(v.plannedProcedure) || S(v.reason) || S(v.type));
        if (bit) parts.push('[' + S(v.date || '') + '] ' + bit.slice(0, 90));
      }
      return parts.join('; ');
    } catch (e) { return ''; }
  }

  /* HOW AN AI PICK SURVIVES TO THE DRAFT.
     oni's opPrepGenerateOne wrapper re-runs its own bestFor() and OVERWRITES
     row.tplId immediately before generating, for every row where tplManual is
     falsy (feat_mls_opnote_integrity.js install(), the oneWrap `if(row&&!row.
     tplManual){var m=bestFor(...);row.tplId=m.tplId;...}` line). Setting the id
     alone would therefore have had NO EFFECT on the note that actually gets
     written - the feature would look like it worked and change nothing.

     tplManual is the one flag oni honours as "this id was not my default, leave
     it alone", so an applied AI pick sets it, and _opdbAiPick records WHO set
     it so three things stay true:
       - matchRow may re-evaluate its own pick, but never the doctor's;
       - editing the procedure text releases the flag, so oni's deterministic
         re-match runs exactly as it does today;
       - the badge is written from tplMatchSource, so it says "matched by AI",
         never "your selection". Claiming the doctor chose it would be a lie
         about who is responsible for the template on an operative note. */
  function releaseAiPick(row) {
    if (!row || !row._opdbAiPick) return;
    row._opdbAiPick = false;
    row.tplManual = false;
    if (row.tplMatchSource === 'ai') { row.tplMatchSource = ''; row.tplMatchReason = ''; }
  }

  /* The badge lives where oni reads it: #opPrepTpl_i.parentElement's FIRST
     span.mini span. oni's syncTplStatus has already written it by the time this
     runs (this module wraps outermost), and it is only overwritten for the one
     state oni cannot know about. */
  function syncBadge(i) {
    try {
      var row = (window._opPrep || [])[i];
      if (!row || row.tplMatchSource !== 'ai' || !row.tplId) return;
      var sel = document.getElementById('opPrepTpl_' + i);
      if (!sel || !sel.parentElement) return;
      var inner = sel.parentElement.querySelectorAll('span.mini span');
      var badge = inner && inner[0];
      if (!badge) return;
      badge.textContent = '(matched by AI — check it)';
      badge.style.color = '#127a55';
      sel.setAttribute('aria-label', 'Op note template matched by AI, check it');
    } catch (e) {}
  }

  /* THE MATCH for one row. Deterministic first, model second, doctor last. */
  function matchRow(i) {
    var row = (window._opPrep || [])[i];
    if (!row) return Promise.resolve(null);
    /* A pick the DOCTOR made is final. A pick this module made is not. */
    if (row.tplManual && !row._opdbAiPick) return Promise.resolve(null);
    releaseAiPick(row);

    var proc = S(row.proc || (row.appt && row.appt.reason));
    var o = oni();
    var res = null;
    try { res = isFn(window._opBestTemplate) ? window._opBestTemplate(proc) : null; } catch (e) { res = null; }
    if (!res) return Promise.resolve(null);

    row._opdbOptions = null;
    row._opdbAiWhy = '';

    /* F1: safety refusals stand. The model is never asked to overturn them. */
    if (res.noProcedure || res.multi) {
      row._opdbMatch = { source: res.noProcedure ? 'no-procedure' : 'multi-procedure', confident: false, why: S(res.reason) };
      return Promise.resolve(row._opdbMatch);
    }

    if (res.confident && res.tpl) {
      row.tplId = S(res.tpl.id);
      row._opdbMatch = { source: 'matcher', confident: true, why: S(res.reason) };
      return Promise.resolve(row._opdbMatch);
    }

    var cands = candidatesFor(res);
    if (!cands.length) {
      row._opdbMatch = { source: 'none', confident: false, why: S(res.reason || 'no compatible template') };
      return Promise.resolve(row._opdbMatch);
    }

    /* Offer the ranked options no matter what the model says - D4's "best
       options based on auto match" must survive an offline tab. */
    row._opdbOptions = cands.slice(0, 3).map(function (e) {
      return { id: S(e.tpl.id), name: S(e.tpl.name), score: e.score, why: '' };
    });

    if (!aiReady() || cands.length < 2) {
      row._opdbMatch = { source: 'options', confident: false, why: S(res.reason || 'more than one template fits') };
      return Promise.resolve(row._opdbMatch);
    }

    return aiChoose(proc, cands, historyLine(row)).then(function (r) {
      if (!r || !r.id || r.confidence < AI_MIN_CONFIDENCE) {
        /* Unsure: apply nothing, but let the model ORDER the options it did
           rank, so the chips lead with its preference. */
        if (r && r.alternates && r.alternates.length) {
          var head = [];
          for (var k = 0; k < r.alternates.length; k++) {
            for (var j = 0; j < row._opdbOptions.length; j++) {
              if (row._opdbOptions[j].id === r.alternates[k]) { head.push(row._opdbOptions[j]); break; }
            }
          }
          for (var m = 0; m < row._opdbOptions.length; m++) if (head.indexOf(row._opdbOptions[m]) < 0) head.push(row._opdbOptions[m]);
          row._opdbOptions = head.slice(0, 3);
        }
        row._opdbMatch = { source: 'ai-unsure', confident: false,
          why: (r && r.why) ? S(r.why) : S(res.reason || 'more than one template fits') };
        return row._opdbMatch;
      }
      row.tplId = r.id;
      row._opdbAiWhy = r.why;
      /* tplManual is what stops oni's oneWrap overwriting this id with its own
         bestFor() answer a moment before the note is written. _opdbAiPick keeps
         the ownership honest - see releaseAiPick above. */
      row.tplManual = true;
      row._opdbAiPick = true;
      row.tplMatchSource = 'ai';
      row.tplMatchReason = 'Matched by AI from the ranked candidates' + (r.why ? (' — ' + r.why) : '');
      row._opdbMatch = { source: 'ai', confident: true, why: r.why, confidence: r.confidence };
      return row._opdbMatch;
    });
  }

  /* Match every row that still needs one, sequentially (the backfill pattern at
     mls-connect.js:23718 - one AI call at a time, never a burst). */
  var matching = false;
  function matchAll() {
    if (matching) return Promise.resolve(false);
    matching = true;
    var rows = window._opPrep || [], i = -1, touched = false;
    function step() {
      i++;
      if (i >= rows.length) return Promise.resolve(touched);
      var r = rows[i];
      if (!r || r.tplManual || r._opdbMatch) return step();
      var t = r._opdbTriage || triage(r);
      if (t.verdict !== 'needs') return step();
      return matchRow(i).then(function (m) { if (m) touched = true; return step(); });
    }
    return step().then(function (out) {
      matching = false;
      if (out) render();
      return out;
    })['catch'](function () { matching = false; return false; });
  }

  /* ===========================================================================
   * (3) THE SURFACE
   * ======================================================================== */

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#opPrepList{display:flex;flex-direction:column;}',
      '#opPrepList > div{order:2;}',
      '#opPrepList > div.opdb-needs{order:1;}',
      '#opPrepList > div.opdb-held{order:3;}',
      '#opPrepList > div.opdb-done{order:4;}',
      '#opPrepList.opdb-fold > div.opdb-held,#opPrepList.opdb-fold > div.opdb-done{display:none;}',
      '#opPrepList > div.opdb-held,#opPrepList > div.opdb-done{opacity:.72;}',
      '.opdb-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:2px 0 12px;padding:10px 13px;' +
        'border:1px solid var(--line);border-radius:16px;background:var(--card);}',
      '.opdb-bar .opdb-count{font:800 13px/1.3 system-ui,sans-serif;color:var(--ink);}',
      '.opdb-bar .opdb-sub{font:600 12px/1.4 system-ui,sans-serif;color:var(--muted);}',
      '.opdb-bar button{cursor:pointer;border:1px solid var(--line);border-radius:999px;padding:5px 12px;' +
        'background:var(--card);color:var(--ink);font:700 12px/1.2 system-ui,sans-serif;}',
      '.opdb-bar button:hover{background:#eef4fb;}',
      '.opdb-why{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;margin:0 0 10px;padding:8px 11px;' +
        'border-radius:10px;font:600 12px/1.45 system-ui,sans-serif;}',
      '.opdb-why.opdb-w-hold{background:#fdf6e6;border:1px solid #e6cf9a;color:#6d5312;}',
      '.opdb-why.opdb-w-done{background:#eef7f1;border:1px solid #bfe0cc;color:#1b5e39;}',
      '.opdb-why.opdb-w-ok{background:#eef7f1;border:1px solid #bfe0cc;color:#1b5e39;}',
      '.opdb-why button{cursor:pointer;border:1px solid #c9a75a;border-radius:999px;padding:4px 11px;' +
        'background:#fff;color:#6d5312;font:800 11.5px/1.2 system-ui,sans-serif;white-space:nowrap;}',
      '.opdb-why button:hover{background:#fdf0d0;}',
      '.opdb-opts{margin:8px 0 0;padding:9px 11px;border:1px solid #cddcef;border-radius:12px;background:#f6faff;}',
      '.opdb-opts .opdb-h{font:800 11px/1.3 system-ui,sans-serif;color:#204034;margin:0 0 7px;}',
      '.opdb-opts .opdb-chips{display:flex;gap:7px;flex-wrap:wrap;}',
      '.opdb-opts button{cursor:pointer;border:1px solid #b9cfe6;border-radius:999px;padding:5px 11px;' +
        'background:#fff;color:#204034;font:700 12px/1.25 system-ui,sans-serif;max-width:100%;text-align:left;}',
      '.opdb-opts button:hover{background:#e8f1fb;border-color:#7ea8d2;}',
      '.opdb-opts button.opdb-top{border-color:#2E6A4B;box-shadow:0 0 0 1px #2E6A4B inset;}',
      '.opdb-opts .opdb-foot{margin:7px 0 0;font:600 11px/1.4 system-ui,sans-serif;color:var(--muted);}',
      '@media (prefers-reduced-motion:reduce){.opdb-bar,.opdb-why,.opdb-opts{transition:none;}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  var folded = true;   /* D3: the day opens showing only who needs an op note */

  function cardFor(i) {
    /* The card is the row's OWN container. Anchored on the preview node, which
       opPrepRender always emits first inside it, so this never depends on
       #opPrepList's child order. */
    var prev = document.getElementById('opPrepPrev_' + i);
    var node = prev && prev.parentElement;
    if (node && node.parentElement && node.parentElement.id === 'opPrepList') return node;
    var sel = document.getElementById('opPrepTpl_' + i);
    node = sel && sel.parentElement && sel.parentElement.parentElement;
    return (node && node.parentElement && node.parentElement.id === 'opPrepList') ? node : null;
  }

  function statusWord(t) {
    if (t.status === 'completed') return 'checked out';
    if (t.status === 'checked_in' || t.status === 'arrived' || t.checkedIn) return 'checked in';
    if (t.status === 'roomed') return 'roomed';
    return '';
  }

  function decorateRow(i) {
    var row = (window._opPrep || [])[i]; if (!row) return;
    var card = cardFor(i); if (!card) return;
    var t = row._opdbTriage || triage(row);

    card.classList.remove('opdb-needs', 'opdb-held', 'opdb-done');
    card.classList.add(t.verdict === 'needs' ? 'opdb-needs' : (t.verdict === 'done' ? 'opdb-done' : 'opdb-held'));

    /* --- the banner: ALWAYS the card's first child, so the fill box's slot
       (#opPrepNote_i.previousElementSibling) is never touched. --- */
    var old = ownChild(card, 'opdb-why');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var html = '';
    if (t.verdict === 'held') {
      html = '<div class="opdb-why opdb-w-hold"><span style="flex:1;min-width:180px">⏸ <b>Not drafting this one</b> — ' +
        esc(t.why) + '.</span>' +
        '<button type="button" data-opdb-bypass="' + i + '">✍️ Draft anyway</button></div>';
    } else if (t.verdict === 'done') {
      html = '<div class="opdb-why opdb-w-done"><span style="flex:1;min-width:180px">✅ <b>Already done</b> — ' +
        esc(t.why) + '.</span>' +
        '<button type="button" data-opdb-bypass="' + i + '">↻ Draft a new one</button></div>';
    } else if (t.code === 'bypass') {
      html = '<div class="opdb-why opdb-w-hold"><span style="flex:1;min-width:180px">✍️ <b>You chose to draft this one</b> — ' +
        'MLS held it back because ' + esc(S(row._opdbHeldWhy) || 'it did not look like a procedure') + '.</span></div>';
    } else if (t.confirmed) {
      var w = statusWord(t);
      html = '<div class="opdb-why opdb-w-ok"><span style="flex:1;min-width:180px">💉 <b>Procedure visit</b>' +
        (w ? (' — ' + esc(w)) : '') + (t.resuming ? ' · resuming your saved draft' : '') + '.</span></div>';
    }
    if (html) {
      var holder = document.createElement('div');
      holder.innerHTML = html;
      var el = holder.firstChild;
      if (el) card.insertBefore(el, card.firstChild);
    }

    /* --- D4: best options first, the full list underneath.
       Inserted BEFORE the template row, never after it: the slot AFTER it is
       the note textarea's previousElementSibling (the fill box's home), and the
       slot INSIDE it holds the match badge oni reads positionally. --- */
    var oldOpts = ownChild(card, 'opdb-opts');
    if (oldOpts && oldOpts.parentNode) oldOpts.parentNode.removeChild(oldOpts);

    var m = row._opdbMatch;
    var opts = row._opdbOptions;
    if (t.verdict === 'needs' && !row.tplManual && opts && opts.length && m && !m.confident) {
      var sel = document.getElementById('opPrepTpl_' + i);
      var tplRow = sel && sel.parentElement;
      if (tplRow && tplRow.parentElement === card) {
        var box = document.createElement('div');
        box.className = 'opdb-opts';
        var head = (m.source === 'ai-unsure')
          ? 'MLS is not sure which template this is' + (m.why ? (' — ' + m.why) : '') + '. Best matches first:'
          : 'More than one template fits' + (m.why ? (' — ' + m.why) : '') + '. Best matches first:';
        var chips = '';
        for (var k = 0; k < opts.length; k++) {
          chips += '<button type="button" class="' + (k === 0 ? 'opdb-top' : '') + '" data-opdb-pick="' + i +
            '" data-opdb-tpl="' + esc(opts[k].id) + '">' + (k === 0 ? '★ ' : '') + esc(opts[k].name || 'Template') + '</button>';
        }
        box.innerHTML = '<div class="opdb-h">' + esc(head) + '</div><div class="opdb-chips">' + chips + '</div>' +
          '<div class="opdb-foot">Not one of these? Every template you have is in the dropdown below.</div>';
        card.insertBefore(box, tplRow);
      }
    }
  }

  function bar() {
    var list = document.getElementById('opPrepList');
    if (!list || !list.parentNode) return;
    var old = document.getElementById('opdbBar');
    if (window._opPrepMode === 'patient') { if (old && old.parentNode) old.parentNode.removeChild(old); return; }

    var rows = window._opPrep || [];
    if (!rows.length) { if (old && old.parentNode) old.parentNode.removeChild(old); return; }

    var need = 0, held = 0, done = 0;
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i]._opdbTriage || triage(rows[i]);
      if (t.verdict === 'needs') need++; else if (t.verdict === 'done') done++; else held++;
    }
    var other = held + done;
    var el = old;
    if (!el) {
      el = document.createElement('div');
      el.id = 'opdbBar';
      el.className = 'opdb-bar';
      list.parentNode.insertBefore(el, list);
    }
    var line = need
      ? ('<span class="opdb-count">💉 ' + need + ' need' + (need === 1 ? 's' : '') + ' an op note</span>')
      : ('<span class="opdb-count">No op notes to draft on this day</span>');
    var sub = other
      ? ('<span class="opdb-sub">' + other + ' other patient' + (other === 1 ? '' : 's') + ' on the schedule — ' +
         (done ? (done + ' already done' + (held ? ', ' : '')) : '') + (held ? (held + ' not a procedure or not performed') : '') + '</span>')
      : '';
    var btn = other
      ? ('<button type="button" id="opdbFold" style="margin-left:auto">' +
         (folded ? ('Show all ' + rows.length + ' scheduled') : 'Show only who needs an op note') + '</button>')
      : '';
    el.innerHTML = line + sub + btn;
    list.classList[folded && other ? 'add' : 'remove']('opdb-fold');
  }

  var rendering = false;
  function render() {
    if (rendering) return;
    rendering = true;
    try {
      css();
      var box = document.getElementById('opPrepList');
      if (!box) return;
      triageAll();
      var rows = window._opPrep || [];
      for (var i = 0; i < rows.length; i++) { decorateRow(i); syncBadge(i); }
      bar();
    } catch (e) {} finally { rendering = false; }
  }

  /* One delegated listener for every control this module renders. */
  function onClick(ev) {
    var el = ev && ev.target;
    if (!el || !el.closest) return;
    var b = el.closest('button'); if (!b) return;

    if (b.id === 'opdbFold') {
      ev.preventDefault(); ev.stopPropagation();
      folded = !folded; render(); return;
    }
    var by = b.getAttribute && b.getAttribute('data-opdb-bypass');
    if (by != null && by !== '') {
      ev.preventDefault(); ev.stopPropagation();
      var i = +by, row = (window._opPrep || [])[i];
      if (!row) return;
      var was = row._opdbTriage || triage(row);
      row._opdbHeldWhy = S(was.why);
      row._opdbBypass = true;
      row._opdbTriage = null;
      say('Drafting ' + S(row.appt && row.appt.name) + ' anyway — you asked for this one.', '');
      render();
      matchRow(i).then(function () { render(); })['catch'](function () {});
      return;
    }
    var pick = b.getAttribute && b.getAttribute('data-opdb-pick');
    if (pick != null && pick !== '') {
      ev.preventDefault(); ev.stopPropagation();
      var ix = +pick, tplId = b.getAttribute('data-opdb-tpl'), r2 = (window._opPrep || [])[ix];
      if (!r2 || !tplId) return;
      r2.tplId = S(tplId);
      r2.tplManual = true;
      r2._opdbAiPick = false;   /* the doctor owns this one now, not the model */
      r2.tplMatchSource = 'manual';
      r2.tplMatchReason = 'Clinician chose from the suggested matches';
      r2._opdbOptions = null;
      var sel = document.getElementById('opPrepTpl_' + ix);
      if (sel) sel.value = r2.tplId;
      var t = null;
      try { t = isFn(window.getTemplateById) ? window.getTemplateById(r2.tplId) : null; } catch (e) {}
      say('Template set: ' + S(t && t.name || 'template'), 'ok');
      if (isFn(window.opPrepRender)) window.opPrepRender(); else render();
      return;
    }
  }

  /* ===========================================================================
   * (4) WRAPPERS - outermost, call-through, idempotent
   * ======================================================================== */

  var originals = {};

  function wrapRender() {
    var base = window.opPrepRender;
    if (!isFn(base) || base.__opdb) return;
    originals.render = base;
    var wrapped = function () {
      var out = base.apply(this, arguments);
      try { render(); } catch (e) {}
      return out;
    };
    wrapped.__opdb = true;
    window.opPrepRender = wrapped;
  }

  function wrapOpen() {
    var base = window.openOpPrep;
    if (!isFn(base) || base.__opdb) return;
    originals.open = base;
    var wrapped = function () {
      var out = base.apply(this, arguments);
      try {
        folded = true;
        var rows = window._opPrep || [];
        for (var i = 0; i < rows.length; i++) { rows[i]._opdbTriage = null; rows[i]._opdbMatch = null; rows[i]._opdbOptions = null; }
        render();
        matchAll();
      } catch (e) {}
      return out;
    };
    wrapped.__opdb = true;
    window.openOpPrep = wrapped;
  }

  /* THE CORE FIX, PART 1 AND THE LOAD-BEARING ONE: the gate is PER ROW.
     Every runner in the app - ScribeFlow's base opPrepGenerateAll, oni's
     allWrap, and mls-connect's richer __mlsTplPrepFix.draftAll (retry/backoff,
     low-confidence reroute, per-patient ledger) - reaches a patient through
     window.opPrepGenerateOne(i). Refusing a held row HERE therefore holds it in
     every path at once, including any runner written after this module, instead
     of only in the one loop this file happens to know about.

     That is deliberate and it is the second design. The first re-implemented
     the draft-all loop, which would have silently defeated the truce commit
     f6ba6ff7 landed hours earlier: the base and oni's wrapper had been fighting
     over which runner a doctor got, and the resolution was "the richer draftAll
     always wins once loaded". A third wrapper that runs its own loop would have
     taken that back without anyone noticing. */
  /* Rows THIS gate refused during the current draft-all pass. A runner we did
     not narrow (the base loop, when mls-connect's draftAll is absent) still
     visits every row and counts our refusals as failures, which would report
     "3 need a confirmed template or a retry" for three patients who were
     deliberately not drafted. Counted here, subtracted there. */
  var gateRefusals = 0;

  function wrapGenerateOne() {
    var base = window.opPrepGenerateOne;
    if (!isFn(base) || base.__opdb) return;
    originals.generateOne = base;
    var wrapped = function (i) {
      var row = (window._opPrep || [])[i];
      if (row) {
        var t = row._opdbTriage || triage(row);
        row._opdbTriage = t;
        if (t.verdict !== 'needs') {
          /* Refuse without drafting, without an AI call, and without throwing:
             every caller reads a falsy return as "this row did not draft", which
             is exactly what happened. */
          try {
            var st = document.getElementById('opPrepStatus');
            if (st) st.textContent = '⏸ Skipped ' + S(row.appt && row.appt.name) + ' — ' + S(t.why) + '.';
          } catch (e) {}
          try { render(); } catch (e2) {}
          gateRefusals++;
          return Promise.resolve(false);
        }
      }
      return Promise.resolve(base.apply(this, arguments));
    };
    wrapped.__opdb = true;
    /* oni stamps its own wrapper and opnp checks for one; carry both markers so
       neither module re-wraps on top of this and re-enters the base twice. */
    wrapped.__oni = base.__oni;
    wrapped.__opnpWrapped = base.__opnpWrapped;
    wrapped.__mlsOpTemplateOwner = base.__mlsOpTemplateOwner;
    window.opPrepGenerateOne = wrapped;
  }

  /* THE CORE FIX, PART 2: draft-day reporting, and NOT a replacement runner.
     Whoever owns the loop keeps owning it. When mls-connect's draftAll is
     present it is handed the triaged index list through its OWN documented
     onlyIdx option, so its retries, its reroute and its ledger all operate on
     the right set; otherwise the base runs untouched and the per-row gate above
     does the holding. Either way this wrapper only adds the count of who was
     skipped and why. */
  function wrapGenerateAll() {
    var base = window.opPrepGenerateAll;
    if (!isFn(base) || base.__opdb) return;
    originals.generateAll = base;
    var wrapped = function () {
      var self = this, args = arguments;
      var rows = window._opPrep || [];
      triageAll();
      var want = needsIndexes();
      var skipped = rows.length - want.length;

      if (!rows.length) return Promise.resolve({ drafted: 0, failed: 0, skipped: 0 });
      if (!want.length) {
        var st0 = document.getElementById('opPrepStatus');
        var msg = skipped === 1
          ? 'Nothing to draft — the one patient on this day does not need an op note.'
          : 'Nothing to draft — none of the ' + rows.length + ' patients on this day need an op note.';
        if (st0) st0.textContent = msg;
        say(msg + ' Use “Draft anyway” on any row you do want.', '');
        render();
        /* NEVER fall through to draftAll here: it reads an EMPTY onlyIdx as
           "no filter given" and would draft the whole day. */
        return Promise.resolve({ drafted: 0, failed: 0, skipped: skipped });
      }

      /* Match before drafting so the model's choice is in place for every row
         this pass will actually write. */
      return matchAll().then(function () {
        triageAll();
        want = needsIndexes();
        if (!want.length) return { drafted: 0, failed: 0, skipped: rows.length };

        gateRefusals = 0;
        var tpf = null;
        try { tpf = window.__mlsTplPrepFix; } catch (e) {}
        var run = (tpf && isFn(tpf.draftAll) && want.length < rows.length)
          ? tpf.draftAll({ onlyIdx: want.slice() })
          : base.apply(self, args);

        return Promise.resolve(run).then(function (out) {
          out = out || {};
          if (skipped) {
            try {
              var st = document.getElementById('opPrepStatus');
              if (st) st.textContent = S(st.textContent) + ' · ' + skipped + ' other patient' +
                (skipped === 1 ? ' was' : 's were') + ' not drafted — open “Show all scheduled” to draft one anyway.';
            } catch (e) {}
          }
          render();
          return {
            drafted: out.drafted || 0,
            failed: Math.max(0, (out.failed || 0) - gateRefusals),
            skipped: skipped
          };
        });
      });
    };
    wrapped.__opdb = true;
    window.opPrepGenerateAll = wrapped;
  }

  /* Re-match when the doctor edits the procedure text: oni's procChanged has
     already re-run the deterministic pick synchronously, so this only refreshes
     the AI layer, debounced. */
  var procTimer = null;
  function wrapProcChanged() {
    var base = window._opProcChanged;
    if (!isFn(base) || base.__opdb) return;
    originals.procChanged = base;
    var wrapped = function (i) {
      /* Release BEFORE the base call: oni's _opProcChanged re-matches only when
         tplManual is falsy, so a stale AI pick would otherwise freeze the row
         on the old template while the doctor retypes the procedure. */
      try { releaseAiPick((window._opPrep || [])[i]); } catch (e0) {}
      var out = base.apply(this, arguments);
      try {
        var row = (window._opPrep || [])[i];
        if (row) { row._opdbTriage = null; row._opdbMatch = null; row._opdbOptions = null; }
        if (procTimer) clearTimeout(procTimer);
        procTimer = setTimeout(function () {
          procTimer = null;
          try { render(); matchRow(i).then(function () { render(); })['catch'](function () {}); } catch (e) {}
        }, 700);
      } catch (e) {}
      return out;
    };
    wrapped.__opdb = true;
    window._opProcChanged = wrapped;
  }

  /* The "🔎 Match template" button: deterministic pick first (oni's, unchanged),
     then the AI layer refines or offers options. */
  function wrapAutoTpl() {
    var base = window._opAutoTpl;
    if (!isFn(base) || base.__opdb) return;
    originals.autoTpl = base;
    var wrapped = function (i) {
      /* Same reason as _opProcChanged: oni's autoTpl is the deterministic
         re-match and it must be allowed to run from a clean slate. */
      try { releaseAiPick((window._opPrep || [])[i]); } catch (e0) {}
      var out = base.apply(this, arguments);
      try {
        var row = (window._opPrep || [])[i];
        if (row) { row.tplManual = false; row._opdbAiPick = false; row._opdbMatch = null; row._opdbOptions = null; }
        matchRow(i).then(function (m) {
          if (m && m.source === 'ai' && m.confident) {
            var t = null;
            try { t = isFn(window.getTemplateById) ? window.getTemplateById(row.tplId) : null; } catch (e) {}
            say('Matched with AI: ' + S(t && t.name || 'template') + (m.why ? (' — ' + m.why) : ''), 'ok');
          }
          if (isFn(window.opPrepRender)) window.opPrepRender(); else render();
        })['catch'](function () {});
      } catch (e) {}
      return out;
    };
    wrapped.__opdb = true;
    window._opAutoTpl = wrapped;
  }

  /* ===========================================================================
   * (5) INSTALL
   *
   * oni (feat_mls_opnote_integrity.js) is the op-note owner and installs on
   * DOMContentLoaded; the room and opnp wrap the same globals. This module must
   * be OUTERMOST, so it waits for oni and then wraps whatever is on top.
   * Bounded setTimeout ladder, never an interval - the boot-script-budget
   * suite's INTERVAL_CEILING is at its limit and a permanent timer here would
   * join the population it guards.
   * ======================================================================== */

  var tries = 0, timer = null, clickBound = false;

  function installOnce() {
    css();
    wrapRender();
    wrapOpen();
    wrapGenerateOne();
    wrapGenerateAll();
    wrapProcChanged();
    wrapAutoTpl();
    if (!clickBound) {
      document.addEventListener('click', onClick, true);
      clickBound = true;
    }
    window.__mlsOpNoteDayBrain.installed = true;
    /* If the room is already open when this lands, decorate it now. */
    try {
      var m = document.getElementById('opPrepModal');
      if (m && m.classList && m.classList.contains('show')) { render(); matchAll(); }
    } catch (e) {}
  }

  function tick() {
    tries++;
    var ready = !!(oni() && oni().installed) && isFn(window.opPrepRender) &&
                isFn(window.opPrepGenerateAll) && isFn(window.opPrepGenerateOne);
    if (ready) { installOnce(); return; }
    if (tries >= 25) {
      /* oni never arrived. Wrap what exists so the day triage still works;
         matching quietly stays deterministic. */
      if (isFn(window.opPrepRender)) installOnce();
      return;
    }
    timer = setTimeout(tick, 400);
  }

  window.__mlsOpNoteDayBrain = {
    installed: false,
    version: VERSION,
    describe: function () {
      return VERSION + ' — AI-assisted op-note template matching over the deterministic ranker, ' +
        'plus procedure-aware day triage so only patients who had a procedure and still need an ' +
        'operative note are drafted.';
    },
    triage: triage,
    triageAll: triageAll,
    needsIndexes: needsIndexes,
    matchRow: matchRow,
    matchAll: matchAll,
    releaseAiPick: releaseAiPick,
    syncBadge: syncBadge,
    aiChoose: aiChoose,
    parseAiReply: parseAiReply,
    isNarrowing: isNarrowing,
    candidatesFor: candidatesFor,
    procedureEvidenceOf: procedureEvidenceOf,
    existingOpNote: existingOpNote,
    statusForRow: statusForRow,
    apptFor: apptFor,
    seenOnDay: seenOnDay,
    checkedInAtFor: checkedInAtFor,
    dayHasStatusSignal: dayHasStatusSignal,
    render: render,
    _setFolded: function (v) { folded = !!v; },
    revert: function () {
      try { if (timer) clearTimeout(timer); } catch (e) {}
      try { if (procTimer) clearTimeout(procTimer); } catch (e) {}
      try { if (clickBound) { document.removeEventListener('click', onClick, true); clickBound = false; } } catch (e) {}
      try { if (originals.render) window.opPrepRender = originals.render; } catch (e) {}
      try { if (originals.open) window.openOpPrep = originals.open; } catch (e) {}
      try { if (originals.generateAll) window.opPrepGenerateAll = originals.generateAll; } catch (e) {}
      try { if (originals.generateOne) window.opPrepGenerateOne = originals.generateOne; } catch (e) {}
      try { if (originals.procChanged) window._opProcChanged = originals.procChanged; } catch (e) {}
      try { if (originals.autoTpl) window._opAutoTpl = originals.autoTpl; } catch (e) {}
      try {
        var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s);
        var b = document.getElementById('opdbBar'); if (b && b.parentNode) b.parentNode.removeChild(b);
        var list = document.getElementById('opPrepList'); if (list) list.classList.remove('opdb-fold');
        var junk = document.querySelectorAll('.opdb-why,.opdb-opts');
        for (var i = 0; i < junk.length; i++) if (junk[i].parentNode) junk[i].parentNode.removeChild(junk[i]);
      } catch (e) {}
      window.__mlsOpNoteDayBrain.installed = false;
      return 'reverted';
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once: true });
  else tick();
})();
