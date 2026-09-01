/* =============================================================================
 * MLS Scribe - SHARED TEAM NOTES ON A PATIENT  (tn-1.0.0)
 *
 * Owner, 2026-09-01: "i need it possible for a head docotr and the docotrs
 * under them to be able to like go in and see there vivists and leave shared
 * notes to each otehr for a patient and for it to be easy. also make the
 * shared notes have a n auto ai generated paitnet info if needed about th e
 * visit and put it in a intuitive place and maek it easy to use".
 *
 * WHAT IS REAL TODAY, AND WHAT THIS DELIBERATELY DOES NOT PRETEND.
 * The practice works in ONE MLS account. There is no login-per-doctor and no
 * role system anywhere in this app, so this module does NOT invent one: it
 * does not gate anything on "head doctor", it does not stamp an identity it
 * cannot verify, and it never claims a note was written by someone the app
 * actually authenticated. What it does is make the surface real for the way
 * the practice works right now - everyone on the account reads and writes the
 * same thread, and each note SAYS who it is from, because a human typed or
 * picked that name. The field is called `author` and it is free text with the
 * roster's own provider names offered as suggestions.
 *
 * That is also what makes the model adoptable later with no migration: when a
 * real multi-account backend exists, an authenticated display name becomes the
 * default value of the same `author` field and everything stored before it
 * still reads correctly. Nothing here would have to be rewritten or migrated.
 * An unverified name is labelled as what it is - the note reads "from Dr X",
 * never "verified as Dr X".
 *
 * WHAT IS STORED (one additive key, one thing to grep, carry and clear):
 *   p.teamNotes = [ {
 *     v: 1,
 *     id: 'tn_<base36 ms>_<rand>',
 *     at: <ms>,            // created
 *     author: 'Matthew Schaeffer, MD',
 *     text: '...',
 *     ai: false,           // true = written by the model, never by a person
 *     ed: <ms>,            // present only if edited
 *     del: true, delAt: <ms>,   // TOMBSTONE - see below
 *     visit: 'YYYY-MM-DD'  // present only when the note is about one visit
 *   } ]
 * PHI discipline: this is chart content and it lives exactly where all other
 * chart content lives - in the account's own patient record, encrypted by the
 * backend like every other field. It is not copied anywhere else.
 *
 * A DELETE IS A TOMBSTONE, NEVER A SPLICE. Two independent reasons, and each
 * one alone is sufficient:
 *   1. The shell's upsertPatient carry (__mlsTeamNotesCarry) UNIONS a stale
 *      caller's array with the stored one so a colleague's note cannot be lost
 *      by a write-back that never saw it. A spliced note is indistinguishable
 *      from a note the stale caller simply never saw, so a union would quietly
 *      RESURRECT every deletion. A tombstone carries a delAt that beats the
 *      original's stamp, so the deletion is what propagates.
 *   2. It is what makes undo honest and what stops two clinicians on two tabs
 *      from reverting each other. Highest revision stamp wins, always.
 * Nothing is ever hard-removed by this module. Refusing to add past NOTES_MAX
 * is the fail-closed answer; silently dropping the oldest note is not.
 *
 * THE WRITE GOES THROUGH upsertPatient, NOT savePatients, and that is the
 * whole difference between a private note and a shared one. upsertPatient
 * enqueues the record for the server; savePatients does not. feat_mls_provider_link
 * deliberately uses savePatients because a month pull can stamp 400 records at
 * once and 400 POSTs is a storm - but a note is one human typing one thing, it
 * must reach the account, and a note that never leaves the device is not a
 * shared note. It writes a COPY of the record: the store's delta is a
 * reference comparison, so mutating the shared row in place would compare
 * equal to itself and journal nothing.
 *
 * THE AI BUTTON REUSES THE APP'S OWN GENERATION TRANSPORT (window.aiCallRaw,
 * freeform -> POST /api/complete). No new endpoint, no second key path. It
 * NEVER runs on its own: there is no timer, no boot hook and no auto-fill
 * anywhere in this file - it runs on a click and nothing else, because an
 * unrequested model paragraph appearing in a shared clinical thread is a
 * defect no matter how good the paragraph is. If there is no signed-in
 * session the button refuses out loud, with the reason, before touching the
 * network. Every generated note is stored ai:true and rendered with an
 * "AI-generated - review before relying on it" tag that is not removable by
 * editing the text.
 *
 * THE VISIT LIST NEVER GUESSES A PROVIDER. A visit row carries no provider
 * field of its own, so a day is attributed only when p.providerLink recorded
 * that exact day for that provider (plv-1.0.0's `days` keys). No day match
 * means the provider column is EMPTY - falling back to the patient's primary
 * provider would silently relabel another clinician's visit, which is the
 * whole reason providerLink is fail-closed in the first place.
 *
 * ES5 only (var/function, no arrows), ASCII-only source (glyphs are HTML
 * entities, the shell's own idiom), matches house feature-module shape.
 * Additive + reversible: __mlsTeamNotes_revert.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsTeamNotes && window.__mlsTeamNotes.installed) return;

  var VERSION = 'tn-1.0.0';
  var BOX_ID = 'pf2TeamNotes';
  var TEXT_MAX = 4000;        /* per note */
  var AUTHOR_MAX = 80;
  var NOTES_MAX = 300;        /* refuse past this; NEVER drop to make room */
  var VISITS_SHOWN = 6;
  var AUTHOR_KEY = 'mls_team_note_author_v1';
  var AI_TAG = 'AI-generated - review before relying on it';

  var stopped = false;
  /* Which patient's thread is expanded. Null = collapsed, which is the state
     every patient starts in: the section is a one-line count until somebody
     asks for it. Keyed by id rather than a boolean so switching charts
     collapses again instead of carrying the last patient's open state over. */
  var openFor = null;
  var pendingUndo = null;     /* {ptId, id} - the one deletion undo offers */
  var busyAi = false;
  var draft = { ptId: '', text: '', author: '' };  /* survives a repaint */

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function S(v) { return v == null ? '' : String(v); }
  function isFn(f) { return typeof f === 'function'; }

  function esc(s) {
    var f = window.esc;
    if (isFn(f)) { var o = safe(function () { return f(s); }, null); if (typeof o === 'string') return o; }
    return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Control characters are stripped, not escaped: they are invisible in the
     thread and they are what turns a stored note into an unreadable blob. */
  function clean(s, max) {
    var t = S(s).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
    return t.slice(0, Number(max) || TEXT_MAX);
  }

  function patients() {
    return safe(function () { var g = window.getPatients; return isFn(g) ? (g() || []) : []; }, []);
  }
  function byId(id) {
    var want = S(id), pts = patients(), i;
    for (i = 0; i < pts.length; i++) if (pts[i] && String(pts[i].id) === want) return pts[i];
    return null;
  }
  function toast(msg, kind) { safe(function () { if (isFn(window.toast)) window.toast(msg, kind); }); }

  /* ------------------------------------------------------------ the model */

  function rev(n) {
    if (!n || typeof n !== 'object') return 0;
    var a = Number(n.at) || 0, e = Number(n.ed) || 0, d = Number(n.delAt) || 0;
    return Math.max(a, e, d);
  }
  function newId(now, rnd) {
    var r = (rnd == null ? Math.random() : rnd);
    return 'tn_' + Number(now || Date.now()).toString(36) + '_' + String(r).slice(2, 8).replace(/[^0-9a-z]/g, '');
  }
  function listOf(p) { return (p && Array.isArray(p.teamNotes)) ? p.teamNotes : []; }
  function live(list) {
    var out = [], i;
    for (i = 0; i < (list || []).length; i++) if (list[i] && !list[i].del) out.push(list[i]);
    return out;
  }
  function countOf(p) { return live(listOf(p)).length; }

  /* The shell owns the union (__mlsTeamNotesUnion) because upsertPatient is
     where a stale write-back is stopped. This mirror keeps the module testable
     and boot-order independent; the suite pins the two against each other. */
  function localUnion(a, b) {
    var lists = [Array.isArray(a) ? a : [], Array.isArray(b) ? b : []], out = [], slot = {}, li, i, n, id, at;
    for (li = 0; li < lists.length; li++) {
      for (i = 0; i < lists[li].length; i++) {
        n = lists[li][i];
        if (!n || typeof n !== 'object') continue;
        id = String(n.id || '');
        if (!id) continue;
        at = slot[id];
        if (at === undefined) { slot[id] = out.length; out.push(n); }
        else if (rev(n) > rev(out[at])) out[at] = n;
      }
    }
    out.sort(function (x, y) {
      var d = (Number(y.at) || 0) - (Number(x.at) || 0);
      if (d) return d;
      var xi = String(x.id || ''), yi = String(y.id || '');
      return xi < yi ? 1 : xi > yi ? -1 : 0;
    });
    return out;
  }
  function union(a, b) {
    var f = window.__mlsTeamNotesUnion;
    if (isFn(f)) { var o = safe(function () { return f(a, b); }, null); if (Array.isArray(o)) return o; }
    return localUnion(a, b);
  }

  /* Every mutation returns a NEW array and a NEW note object. Editing a stored
     note in place would be invisible to the store's reference-comparison delta
     and would journal nothing. */
  function copyNote(n) {
    var o = {}, k;
    for (k in n) if (Object.prototype.hasOwnProperty.call(n, k)) o[k] = n[k];
    return o;
  }
  function addNote(list, opts) {
    opts = opts || {};
    var text = clean(opts.text, TEXT_MAX).trim();
    if (!text) return { ok: false, reason: 'empty' };
    var cur = Array.isArray(list) ? list : [];
    if (live(cur).length >= NOTES_MAX) return { ok: false, reason: 'full' };
    var now = Number(opts.now) || Date.now();
    var n = {
      v: 1, id: opts.id || newId(now, opts.rnd), at: now,
      author: clean(opts.author, AUTHOR_MAX).trim() || 'Unsigned',
      text: text, ai: opts.ai === true
    };
    if (opts.visit) n.visit = S(opts.visit).slice(0, 10);
    return { ok: true, list: union([n], cur), note: n };
  }
  function editNote(list, id, text, now) {
    var cur = Array.isArray(list) ? list : [], want = S(id), i, n, t;
    t = clean(text, TEXT_MAX).trim();
    if (!t) return { ok: false, reason: 'empty' };
    for (i = 0; i < cur.length; i++) {
      n = cur[i];
      if (!n || String(n.id) !== want || n.del) continue;
      var e = copyNote(n);
      e.text = t;
      e.ed = Number(now) || Date.now();
      return { ok: true, list: union([e], cur) };
    }
    return { ok: false, reason: 'missing' };
  }
  /* A TOMBSTONE. See the header - a splice would be resurrected by the carry. */
  function removeNote(list, id, now) {
    var cur = Array.isArray(list) ? list : [], want = S(id), i, n;
    for (i = 0; i < cur.length; i++) {
      n = cur[i];
      if (!n || String(n.id) !== want || n.del) continue;
      var d = copyNote(n);
      d.del = true;
      d.delAt = Number(now) || Date.now();
      return { ok: true, list: union([d], cur) };
    }
    return { ok: false, reason: 'missing' };
  }
  function restoreNote(list, id, now) {
    var cur = Array.isArray(list) ? list : [], want = S(id), i, n;
    for (i = 0; i < cur.length; i++) {
      n = cur[i];
      if (!n || String(n.id) !== want || !n.del) continue;
      var r = copyNote(n);
      /* the restore must OUTRANK its own tombstone, or the union puts the
         tombstone straight back */
      r.del = false;
      r.delAt = 0;
      r.ed = Number(now) || Date.now();
      return { ok: true, list: union([r], cur) };
    }
    return { ok: false, reason: 'missing' };
  }

  /* ------------------------------------------------------------- the write */

  function persist(ptId, next) {
    var p = byId(ptId);
    if (!p) return { ok: false, reason: 'patient-missing' };
    if (!isFn(window.upsertPatient)) return { ok: false, reason: 'store-unavailable' };
    var copy = {}, k;
    for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) copy[k] = p[k];
    copy.teamNotes = next;
    var ok = true;
    try { window.upsertPatient(copy); } catch (e) { ok = false; }
    return { ok: ok, reason: ok ? 'saved' : 'save-failed' };
  }

  function repaint() {
    /* renderProfile is the card's own repaint and calls back into this module,
       exactly as saveProfField does after an inline chart edit. */
    if (isFn(window.renderProfile)) { safe(function () { window.renderProfile(); }); return; }
    var p = activeP();
    if (p) render(p);
  }

  function commit(ptId, res, okMsg) {
    if (!res || !res.ok) {
      if (res && res.reason === 'empty') toast('Type the note first.', 'err');
      else if (res && res.reason === 'full') toast('This patient already has ' + NOTES_MAX + ' team notes. Nothing was removed - delete one you no longer need first.', 'err');
      else toast('Could not update the team notes.', 'err');
      return false;
    }
    var w = persist(ptId, res.list);
    if (!w.ok) { toast('Could not save the note - nothing was changed.', 'err'); return false; }
    if (okMsg) toast(okMsg, 'ok');
    repaint();
    return true;
  }

  /* --------------------------------------------------------------- reading */

  function activeP() {
    return safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null);
  }
  function fieldText(v) {
    var f = window._mlsGenerationFieldText;
    if (isFn(f)) { var o = safe(function () { return f(v); }, null); if (typeof o === 'string') return o; }
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (Array.isArray(v)) return v.map(function (x) { return fieldText(x); }).filter(Boolean).join('\n');
    return S(v);
  }
  function ymd(v) {
    var s = S(v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return '';
  }
  /* ONLY an attributed day. See the header - no primary-provider fallback. */
  function providerForDay(p, day) {
    var l = p && p.providerLink, i, j, e;
    if (!l || l.v !== 1 || !Array.isArray(l.providersSeen) || !day) return '';
    for (i = 0; i < l.providersSeen.length; i++) {
      e = l.providersSeen[i];
      if (!e || !Array.isArray(e.days)) continue;
      for (j = 0; j < e.days.length; j++) if (S(e.days[j]) === day) return S(e.name);
    }
    return '';
  }
  function visitDocumented(v) {
    if (!v) return false;
    if (v.bodyComplete === true && S(v.raw).trim()) return true;
    return !!S(v.raw || v.detail || v.text || v.note).trim();
  }
  /* Read-only, derived entirely from what the card already holds. */
  function recentVisits(p, max) {
    var vs = (p && Array.isArray(p.visits)) ? p.visits : [], rows = [], i, v, day;
    var notes = live(listOf(p)), tagged = {}, k;
    for (k = 0; k < notes.length; k++) if (notes[k].visit) tagged[S(notes[k].visit)] = (tagged[S(notes[k].visit)] || 0) + 1;
    for (i = 0; i < vs.length; i++) {
      v = vs[i]; if (!v) continue;
      day = ymd(v.date);
      if (!day) continue;
      rows.push({
        date: day,
        provider: S(v.provider).trim() || providerForDay(p, day),
        documented: visitDocumented(v),
        teamNotes: tagged[day] || 0,
        type: S(v.type).slice(0, 60)
      });
    }
    rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return { total: rows.length, rows: rows.slice(0, Number(max) || VISITS_SHOWN) };
  }

  /* Provider names already known to this roster, offered as author suggestions.
     Suggestions only - the field stays free text, because the person at the
     keyboard may not be in the roster at all. */
  function authorSuggestions() {
    var pts = patients(), seen = {}, out = [], i, j, l, e, n;
    for (i = 0; i < pts.length; i++) {
      l = pts[i] && pts[i].providerLink;
      if (!l || l.v !== 1 || !Array.isArray(l.providersSeen)) continue;
      for (j = 0; j < l.providersSeen.length; j++) {
        e = l.providersSeen[j];
        n = S(e && e.name).trim();
        if (!n || seen[n]) continue;
        seen[n] = 1; out.push(n);
      }
    }
    out.sort();
    return out.slice(0, 30);
  }
  function lastAuthor() { return safe(function () { return S(localStorage.getItem(AUTHOR_KEY)); }, ''); }
  function rememberAuthor(v) {
    safe(function () {
      var t = clean(v, AUTHOR_MAX).trim();
      if (t) localStorage.setItem(AUTHOR_KEY, t); else localStorage.removeItem(AUTHOR_KEY);
    });
  }

  /* ------------------------------------------------------------------- UI */

  function stamp(ms) {
    return safe(function () { return new Date(Number(ms) || 0).toLocaleString(); }, '');
  }
  var CHIP = 'font-size:11px;border-radius:999px;padding:2px 9px;white-space:nowrap';

  function noteHtml(n) {
    var edited = Number(n.ed) > 0 && !n.del;
    return '<div class="mls-tn-note" data-tn-id="' + esc(n.id) + '" style="border:1px solid #EFEDE6;border-radius:10px;padding:9px 11px;background:#FCFBF8">' +
      '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px">' +
        '<b style="font-size:13px;color:#1a2b3c">' + esc(n.author || 'Unsigned') + '</b>' +
        '<span style="font-size:11.5px;color:var(--muted)">' + esc(stamp(n.at)) + (edited ? ' &#183; edited' : '') + '</span>' +
        (n.ai === true ? ('<span style="' + CHIP + ';color:#5a4300;background:#FDF3D8;border:1px solid #EBD9A4;font-weight:700" title="' + esc(AI_TAG) + '">AI-generated - review</span>') : '') +
        (n.visit ? ('<span style="' + CHIP + ';color:var(--muted);background:var(--soft)">about ' + esc(n.visit) + '</span>') : '') +
        '<span style="margin-left:auto;display:flex;gap:6px">' +
          '<button type="button" class="edit" data-tn-act="edit" data-tn-id="' + esc(n.id) + '" title="Edit this note">&#9998; Edit</button>' +
          '<button type="button" class="edit" data-tn-act="del" data-tn-id="' + esc(n.id) + '" title="Delete this note (you can undo)">&#128465; Delete</button>' +
        '</span>' +
      '</div>' +
      '<div style="white-space:pre-wrap;font-size:13.5px;line-height:1.5;color:#243444">' + esc(n.text) + '</div>' +
    '</div>';
  }

  function editorHtml(n) {
    return '<div class="mls-tn-note" style="border:1px solid #cfe0d6;border-radius:10px;padding:9px 11px;background:#F6FBF8">' +
      '<textarea id="mlsTnEditText" class="inline-edit-area" rows="4" aria-label="Edit this team note" ' +
        'style="width:100%;box-sizing:border-box">' + esc(n.text) + '</textarea>' +
      '<div class="inline-edit-actions" style="display:flex;gap:8px;margin-top:7px">' +
        '<button type="button" class="btn-green" data-tn-act="editsave" data-tn-id="' + esc(n.id) + '">Save</button>' +
        '<button type="button" class="btn-ghost" data-tn-act="editcancel">Cancel</button>' +
        '<span style="font-size:11.5px;color:var(--muted);align-self:center">Enter saves, Shift+Enter adds a line.</span>' +
      '</div>' +
    '</div>';
  }

  function visitsHtml(p) {
    var got = recentVisits(p, VISITS_SHOWN), i, r, out;
    if (!got.total) {
      return '<div class="mini" style="color:var(--muted)">No visits recorded for this patient yet.</div>';
    }
    out = '<div style="display:flex;flex-direction:column;gap:3px">';
    for (i = 0; i < got.rows.length; i++) {
      r = got.rows[i];
      out += '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:12.5px;padding:3px 0;border-bottom:1px solid #F2F0EA">' +
        '<span style="font-variant-numeric:tabular-nums;color:#243444;font-weight:600">' + esc(r.date) + '</span>' +
        (r.provider ? ('<span style="' + CHIP + ';color:#204034;background:#EAF1EC;border:1px solid #cfe0d6;font-weight:700">' + esc(r.provider) + '</span>')
                    : ('<span style="font-size:11.5px;color:var(--muted)" title="No attributed appointment named a provider for this day - MLS will not guess one">provider not recorded</span>')) +
        (r.type ? ('<span style="font-size:11.5px;color:var(--muted)">' + esc(r.type) + '</span>') : '') +
        '<span style="margin-left:auto;display:flex;gap:6px;align-items:baseline">' +
          (r.documented ? '<span style="font-size:11.5px;color:#204034" title="A visit note is stored for this visit">&#128221; note on file</span>'
                        : '<span style="font-size:11.5px;color:var(--muted)" title="No visit note body is stored for this visit">no note on file</span>') +
          (r.teamNotes ? ('<span style="' + CHIP + ';color:#5a4300;background:#FDF3D8;border:1px solid #EBD9A4" title="Team notes written about this visit">' + r.teamNotes + ' team</span>') : '') +
        '</span>' +
      '</div>';
    }
    out += '</div>';
    if (got.total > got.rows.length) {
      out += '<div class="mini" style="color:var(--muted);margin-top:5px">Showing the ' + got.rows.length + ' most recent of ' + got.total + ' visits.</div>';
    }
    return out;
  }

  function bodyHtml(p, editingId) {
    var list = listOf(p), shown = live(list), i, out;
    var sugg = authorSuggestions();
    var who = (draft.ptId === String(p.id) && draft.author) ? draft.author : (lastAuthor() || '');
    var text = (draft.ptId === String(p.id)) ? draft.text : '';

    out = '<div id="mlsTnBody" style="margin-top:9px">';

    /* --- the one obvious add box --- */
    out += '<div style="border:1px solid #E2DFD6;border-radius:10px;padding:9px 11px;background:#fff">' +
      '<textarea id="mlsTnNew" rows="2" aria-label="Write a note to the team about this patient" ' +
        'placeholder="Write a note to the team about this patient. Enter saves." ' +
        'style="width:100%;box-sizing:border-box;font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 9px;resize:vertical">' + esc(text) + '</textarea>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:7px">' +
        '<label for="mlsTnAuthor" style="font-size:12px;color:var(--muted)">From</label>' +
        '<input id="mlsTnAuthor" list="mlsTnAuthors" autocomplete="off" maxlength="' + AUTHOR_MAX + '" ' +
          'placeholder="Your name" value="' + esc(who) + '" ' +
          'style="font:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:6px 9px;min-width:180px">' +
        '<datalist id="mlsTnAuthors">';
    for (i = 0; i < sugg.length; i++) out += '<option value="' + esc(sugg[i]) + '"></option>';
    out += '</datalist>' +
        '<button type="button" class="btn-green" data-tn-act="add" style="font-size:13px;padding:7px 13px">Add note</button>' +
        '<button type="button" class="btn-ghost" data-tn-act="ai" id="mlsTnAiBtn" ' +
          /* This tooltip says the chart is sent, because it is. An earlier
             draft read "nothing is sent anywhere", which is true only of the
             button sitting there unpressed and false the moment it is used -
             and a privacy claim that is false in the only case that matters is
             worse than no claim at all. */
          'title="Ask MLS to draft a short plain-language overview of this patient from the stored chart and the most recent visit. Pressing this sends the chart to your MLS account\'s AI service; nothing is generated or sent until you do. The result is added as a note marked AI-generated for you to review." ' +
          'style="font-size:13px;padding:7px 13px">&#10024; Generate visit summary</button>' +
      '</div>' +
    '</div>';

    /* --- undo strip for the one deletion we are still offering to reverse --- */
    if (pendingUndo && pendingUndo.ptId === String(p.id)) {
      out += '<div style="margin-top:8px;display:flex;align-items:center;gap:9px;background:#FDF3D8;border:1px solid #EBD9A4;border-radius:9px;padding:7px 11px;font-size:12.5px">' +
        '<span>Note deleted.</span>' +
        '<button type="button" class="edit" data-tn-act="undo">Undo</button>' +
      '</div>';
    }

    /* --- the thread --- */
    out += '<div style="margin-top:9px;display:flex;flex-direction:column;gap:7px">';
    if (!shown.length) {
      out += '<div class="mini" style="color:var(--muted)">No team notes yet. The first one is the note the next doctor reads.</div>';
    } else {
      for (i = 0; i < shown.length; i++) {
        out += (editingId && String(shown[i].id) === String(editingId)) ? editorHtml(shown[i]) : noteHtml(shown[i]);
      }
    }
    out += '</div>';

    /* --- visits across providers, read-only --- */
    out += '<div style="margin-top:13px;padding-top:10px;border-top:1px solid #EFEDE6">' +
      '<div style="font-size:12.5px;font-weight:700;color:#243444;margin-bottom:5px">Recent visits</div>' +
      visitsHtml(p) +
    '</div>';

    out += '</div>';
    return out;
  }

  var editingId = null;

  function render(p) {
    var box = safe(function () { return document.getElementById(BOX_ID); }, null);
    if (!box) return false;
    if (!p || p.id == null) { box.style.display = 'none'; box.innerHTML = ''; return false; }
    var id = String(p.id);
    if (openFor !== null && openFor !== id) { openFor = null; editingId = null; pendingUndo = null; }
    var open = (openFor === id);
    var n = countOf(p);

    var head = '<h3 style="margin:0">' +
      '<button type="button" data-tn-act="toggle" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="mlsTnBody" ' +
        'title="Notes the doctors on this account leave each other about this patient" ' +
        'style="font:inherit;font-size:15px;font-weight:700;color:#243444;background:none;border:none;padding:0;cursor:pointer;display:flex;align-items:center;gap:8px">' +
        '<span>&#128221; Team notes</span>' +
        (n ? ('<span style="' + CHIP + ';color:#204034;background:#EAF1EC;border:1px solid #cfe0d6;font-weight:700">' + n + '</span>')
           : ('<span style="' + CHIP + ';color:var(--muted);background:var(--soft)">none yet</span>')) +
        '<span style="color:var(--muted);font-size:12px">' + (open ? '&#9662;' : '&#9656;') + '</span>' +
      '</button>' +
    '</h3>';

    box.innerHTML = head + (open ? bodyHtml(p, editingId) : '');
    box.style.display = '';
    wire(box);
    return true;
  }

  /* ONE delegated listener on the box, installed once. innerHTML replaces the
     children on every repaint, so a per-button listener would be orphaned by
     the first save; the box itself survives. This is the shell's own
     _renderProfUnpulledNotice idiom. */
  function wire(box) {
    if (!box || box.__mlsTnWired) return;
    box.__mlsTnWired = 1;
    safe(function () { box.addEventListener('click', onClick, false); });
    safe(function () { box.addEventListener('keydown', onKey, false); });
  }

  function actOf(t) {
    var el = t;
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute('data-tn-act')) return el;
      el = el.parentNode;
    }
    return null;
  }
  function val(id) {
    var el = safe(function () { return document.getElementById(id); }, null);
    return el ? S(el.value) : '';
  }
  function stashDraft(ptId) {
    draft = { ptId: String(ptId), text: val('mlsTnNew'), author: val('mlsTnAuthor') };
  }
  function clearDraft() { draft = { ptId: '', text: '', author: '' }; }

  function onClick(ev) {
    var el = actOf(ev && ev.target);
    if (!el) return;
    var act = el.getAttribute('data-tn-act');
    var p = activeP();
    if (!p) { toast('Select a patient first.', 'err'); return; }
    var ptId = String(p.id);
    safe(function () { ev.preventDefault(); ev.stopPropagation(); });

    if (act === 'toggle') {
      /* Keep a half-typed note across a collapse. Only when it is CURRENTLY
         open: stashing on the way open would read an input that has not been
         rendered yet and blank the draft it was meant to protect. */
      if (openFor === ptId) stashDraft(ptId);
      openFor = (openFor === ptId) ? null : ptId;
      editingId = null;
      render(p);
      return;
    }
    if (act === 'add') { doAdd(p); return; }
    if (act === 'ai') { doAi(p, el); return; }
    if (act === 'edit') { stashDraft(ptId); editingId = el.getAttribute('data-tn-id'); render(p); return; }
    if (act === 'editcancel') { editingId = null; render(p); return; }
    if (act === 'editsave') {
      var t = val('mlsTnEditText');
      var res = editNote(listOf(p), el.getAttribute('data-tn-id'), t, Date.now());
      editingId = null;
      commit(ptId, res, 'Note updated.');
      return;
    }
    if (act === 'del') {
      stashDraft(ptId);
      var id = el.getAttribute('data-tn-id');
      var d = removeNote(listOf(p), id, Date.now());
      if (commit(ptId, d, '')) { pendingUndo = { ptId: ptId, id: id }; repaint(); }
      return;
    }
    if (act === 'undo') {
      if (!pendingUndo || pendingUndo.ptId !== ptId) return;
      var r = restoreNote(listOf(p), pendingUndo.id, Date.now());
      pendingUndo = null;
      commit(ptId, r, 'Note restored.');
      return;
    }
  }

  /* Enter saves - the owner asked for easy, and a note is one line far more
     often than it is five. Shift+Enter still adds a line. */
  function onKey(ev) {
    if (!ev || ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var t = ev.target, id = t && t.id;
    var p = activeP();
    if (!p) return;
    if (id === 'mlsTnNew' || id === 'mlsTnAuthor') {
      safe(function () { ev.preventDefault(); });
      doAdd(p);
      return;
    }
    if (id === 'mlsTnEditText') {
      safe(function () { ev.preventDefault(); });
      /* editingId IS the answer - exactly one note is ever open for editing,
         and the module already knows which. An earlier version rediscovered it
         by querying the Save button's data-tn-id, which is the same fact read
         back out of the markup it just wrote: more code, one more way to be
         wrong, and untestable without a real DOM. */
      var res = editNote(listOf(p), editingId, S(t.value), Date.now());
      editingId = null;
      commit(String(p.id), res, 'Note updated.');
    }
  }

  function doAdd(p) {
    var text = val('mlsTnNew'), author = val('mlsTnAuthor');
    var res = addNote(listOf(p), { text: text, author: author, ai: false, now: Date.now() });
    if (!res.ok) { commit(String(p.id), res, ''); return; }
    rememberAuthor(author);
    pendingUndo = null;
    clearDraft();
    commit(String(p.id), res, 'Note added for the team.');
  }

  /* --------------------------------------------------------------- the AI */

  /* backendMode() alone is NOT a session - it is true in hosted mode with no
     token at all, which is how an unauthenticated request gets fired and comes
     back 401. The token is the session. */
  function signedIn() {
    return safe(function () {
      return !!(isFn(window.backendMode) && window.backendMode() && isFn(window.bkToken) && window.bkToken());
    }, false);
  }

  function latestVisit(p) {
    var got = recentVisits(p, 1);
    return got.rows.length ? got.rows[0] : null;
  }
  /* Assembled from THIS patient record only. buildPatientContext() would have
     been the shorter call, but it folds in getContext() - the visit editor's
     textarea - which belongs to whatever visit is open, not necessarily to
     this chart. Reading ambient editor state into one patient's summary is the
     cross-patient contamination class, so the record is the only source. */
  function chartSource(p) {
    var lines = [], demo, i, vs, v, body;
    lines.push('PATIENT: ' + S(p.name));
    demo = [S(p.sex), S(p.dob), p.mrn ? ('MRN ' + S(p.mrn)) : ''];
    demo = demo.filter(function (x) { return !!x; }).join(' - ');
    if (demo) lines.push('Demographics: ' + demo);
    if (p.providerLink && p.providerLink.v === 1 && p.providerLink.primaryProvider) {
      lines.push('Primary provider on record: ' + S(p.providerLink.primaryProvider));
    }
    if (fieldText(p.problems)) lines.push('Problem list:\n' + fieldText(p.problems).slice(0, 2000));
    if (fieldText(p.meds)) lines.push('Current medications:\n' + fieldText(p.meds).slice(0, 2000));
    if (fieldText(p.allergies)) lines.push('Allergies:\n' + fieldText(p.allergies).slice(0, 1000));
    if (fieldText(p.summary)) lines.push('Running history:\n' + fieldText(p.summary).slice(0, 3000));
    vs = (p && Array.isArray(p.visits)) ? p.visits.slice() : [];
    vs.sort(function (a, b) { var x = ymd(a && a.date), y = ymd(b && b.date); return x < y ? 1 : x > y ? -1 : 0; });
    for (i = 0; i < vs.length && i < 3; i++) {
      v = vs[i];
      body = S(v && (v.raw || v.detail || v.text)).trim();
      if (!ymd(v && v.date) && !body) continue;
      lines.push('Encounter ' + ymd(v.date) + (S(v.type) ? (' - ' + S(v.type)) : '') + ':\n' + (body ? body.slice(0, 2500) : '(no stored body)'));
    }
    return lines.join('\n\n').slice(0, 12000);
  }

  var AI_SYS =
    'You are helping one clinical care team share context about a single patient. ' +
    'Write a SHORT plain-language overview - four to six sentences, one paragraph, no headings and no bullet points - ' +
    'that another clinician on this team could read in fifteen seconds before walking in to see this patient. ' +
    'Say who the patient is, the active problems that actually matter, and what happened at the most recent encounter. ' +
    'Use ONLY facts present in the record below. If something is not in the record, leave it out entirely: never infer, ' +
    'never estimate, and never state a diagnosis, medication, dose, date or finding that is not written there. ' +
    'If the record is too thin to summarize, say exactly that in one sentence and stop. ' +
    'You are writing for colleagues, not for the patient, so do not address the patient directly.';

  function aiBtn() { return safe(function () { return document.getElementById('mlsTnAiBtn'); }, null); }

  function doAi(p, btn) {
    if (busyAi) { toast('Still writing the summary - one moment.', ''); return; }
    if (!isFn(window.aiCallRaw)) { toast('The AI helper is not loaded on this page yet. Reload and try again.', 'err'); return; }
    if (!signedIn()) {
      toast('Sign in to generate a visit summary - it runs on your MLS account, so it needs your session. Nothing was sent.', 'err');
      return;
    }
    var src = chartSource(p);
    if (S(src).replace(/PATIENT:.*/, '').trim().length < 20) {
      toast('There is not enough in this chart yet to summarize. Pull or enter the chart first.', 'err');
      return;
    }
    var ptId = String(p.id);
    var lv = latestVisit(p);
    stashDraft(ptId);
    busyAi = true;
    var label = btn ? btn.innerHTML : '';
    safe(function () { if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Writing...'; } });
    var done = function () {
      busyAi = false;
      var b = aiBtn();
      safe(function () { if (b) { b.disabled = false; if (label) b.innerHTML = label; } });
    };
    var key = safe(function () { return isFn(window.getKey) ? window.getKey() : ''; }, '');
    safe(function () {
      window.aiCallRaw(AI_SYS, src, key, { freeform: true, family: 'general_draft', maxTokens: 400 })
        .then(function (out) {
          var text = S(out).replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
          done();
          if (!text) { toast('The AI returned nothing. Nothing was added.', 'err'); return; }
          var res = addNote(listOf(byId(ptId) || p), {
            text: text, author: 'MLS AI', ai: true, now: Date.now(),
            visit: lv ? lv.date : ''
          });
          if (commit(ptId, res, 'Summary added as a team note - review it before relying on it.')) pendingUndo = null;
        })
        .catch(function (err) {
          done();
          var msg = safe(function () { return isFn(window.friendlyError) ? window.friendlyError(err) : ''; }, '');
          toast(msg || 'Could not generate the summary. Nothing was added.', 'err');
        });
    });
  }

  /* -------------------------------------------------------------- exports */

  function forPatient(id) {
    var p = byId(id);
    return p ? live(listOf(p)).slice() : [];
  }
  /* phteam-1.0.0 (b1169): THE ADD-AND-PERSIST ENTRY POINT, which this module
     did not have. `addNote` is a pure list transform and `persist`/`commit`
     were private, so a second surface (the phone) could READ the thread through
     forPatient() but had no way to WRITE one without re-implementing the copy
     + upsertPatient write beside it. A second write path is how two stores are
     born, so the one write lives here, where the tombstone/union law and the
     NOTES_MAX refusal already are.

     Purely additive: no existing caller changes, and the desktop's own
     doAdd -> commit path is untouched. It does NOT toast and it does NOT
     repaint unless asked - a caller that owns its own surface says what
     happened in its own words, and renderProfile() is a desktop repaint that a
     phone has no use for. Returns the same {ok, reason} vocabulary the rest of
     this file speaks, plus the stored note, so a caller can show it at once
     instead of waiting for a round trip. */
  function addFor(ptId, opts) {
    opts = opts || {};
    var p = byId(ptId);
    if (!p) return { ok: false, reason: 'patient-missing' };
    var res = addNote(listOf(p), {
      text: opts.text, author: opts.author, ai: opts.ai === true,
      visit: opts.visit, now: opts.now
    });
    if (!res.ok) return { ok: false, reason: res.reason };
    var w = persist(ptId, res.list);
    if (!w.ok) return { ok: false, reason: w.reason };
    if (opts.repaint === true) safe(function () { repaint(); });
    return { ok: true, reason: 'saved', note: res.note, count: live(res.list).length };
  }
  function status() {
    return { version: VERSION, installed: true, stopped: stopped, open: openFor, busyAi: busyAi };
  }

  window.__mlsTeamNotes = {
    installed: true, version: VERSION,
    render: render, forPatient: forPatient, addFor: addFor, status: status,
    addNote: addNote, editNote: editNote, removeNote: removeNote, restoreNote: restoreNote,
    union: localUnion, rev: rev, live: live, countOf: countOf,
    recentVisits: recentVisits, providerForDay: providerForDay,
    chartSource: chartSource, signedIn: signedIn, authorSuggestions: authorSuggestions,
    noteHtml: noteHtml, bodyHtml: bodyHtml, newId: newId, AI_SYS: AI_SYS, AI_TAG: AI_TAG,
    NOTES_MAX: NOTES_MAX, TEXT_MAX: TEXT_MAX
  };
  /* the one hook renderProfile calls */
  window.__mlsTeamNotesRender = function (p) {
    if (stopped) return false;
    return render(p);
  };

  window.__mlsTeamNotes_revert = function () {
    stopped = true;
    safe(function () {
      var box = document.getElementById(BOX_ID);
      if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    });
    safe(function () { delete window.__mlsTeamNotesRender; delete window.__mlsTeamNotes; });
  };

  /* NO BOOT TIMER, NO AUTO-RUN, NO AUTO-GENERATE. This module does nothing at
     all until renderProfile calls it with a patient, and it never contacts the
     model without a click. Loading it defines functions. */
})();
