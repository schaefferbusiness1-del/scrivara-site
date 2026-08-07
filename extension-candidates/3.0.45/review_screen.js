/* MLS Assist — Athena write review screen (rvs-1.0.0).
 *
 * Extension-side, enforcement-grade counterpart to the app's wfr review sheet.
 * The app posts a manifest of proposed Athena writes over the trusted bridge
 * (`mlsAppReviewScreen`); this module classifies every row through
 * MLSWriteSafety (note text / diagnosis / billing / order-like / medication /
 * referral / other), shows exactly WHAT would be written and WHERE in Athena
 * it would go, and lets the doctor select ONLY the writable rows. Anything
 * order / prescription / referral / billing / diagnosis-shaped renders locked,
 * preview-only, with a "do this manually in Athena" note — the lock is policy
 * (MLSWriteSafety.evaluateProposal), not styling, and the same policy is
 * re-enforced in the background gate and the driver, so a tampered screen
 * cannot widen what executes.
 *
 * Pure model-building (buildReviewModel/summarizeModel) is DOM-free and unit
 * tested in Node; render() is the thin shadow-DOM layer.
 */
(function (root) {
  'use strict';
  if (root.MLSReviewScreen && root.MLSReviewScreen.version) return;
  var VERSION = 'rvs-1.0.0';

  function guard() { return root.MLSWriteSafety || null; }
  function text(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  var STATUS_META = {
    safe:            { label: 'Safe to write',   selectable: true,  note: 'Will be written only after you confirm.' },
    selected:        { label: 'Selected',        selectable: true,  note: 'Will be written only after you confirm.' },
    blocked:         { label: 'Preview only',    selectable: false, note: 'Write-safety policy: perform this step yourself in athenaOne.' },
    'needs-manual':  { label: 'Needs manual',    selectable: false, note: 'Could not be classified as note text — enter it manually in athenaOne.' }
  };

  /* manifest: { patient: {name, dob, mrn}, context: {provider, visitDate, practiceId},
                items: [{ id, kind, title, text, destination: {sectionLabel, frameUrl, taught}, selected }] } */
  function buildReviewModel(manifest) {
    manifest = manifest && typeof manifest === 'object' ? manifest : {};
    var ws = guard();
    var items = Array.isArray(manifest.items) ? manifest.items : [];
    var rows = [];
    for (var i = 0; i < items.length && i < 80; i++) {
      var item = items[i] || {};
      var evaluated = ws ? ws.evaluateProposal(item)
        : { category: 'other', categoryLabel: 'Other', status: 'needs-manual' }; // no guard -> fail closed
      var dest = item.destination && typeof item.destination === 'object' ? item.destination : {};
      var meta = STATUS_META[evaluated.status] || STATUS_META['needs-manual'];
      rows.push({
        id: text(item.id) || ('row-' + i),
        title: text(item.title || item.label) || evaluated.categoryLabel,
        preview: String(item.text == null ? '' : item.text).slice(0, 4000),
        category: evaluated.category,
        categoryLabel: evaluated.categoryLabel,
        status: evaluated.status,
        statusLabel: meta.label,
        selectable: meta.selectable,
        statusNote: meta.note,
        checked: meta.selectable && item.selected === true,
        destination: {
          sectionLabel: text(dest.sectionLabel || dest.label) || '(destination not yet taught)',
          frameUrl: text(dest.frameUrl).slice(0, 300),
          taught: dest.taught === true
        }
      });
    }
    var patient = manifest.patient && typeof manifest.patient === 'object' ? manifest.patient : {};
    var context = manifest.context && typeof manifest.context === 'object' ? manifest.context : {};
    return {
      version: VERSION,
      patient: { name: text(patient.name), dob: text(patient.dob), mrn: text(patient.mrn) },
      context: { provider: text(context.provider), visitDate: text(context.visitDate), practiceId: text(context.practiceId) },
      rows: rows,
      summary: summarizeModel(rows)
    };
  }
  function summarizeModel(rows) {
    var out = { total: rows.length, writable: 0, blocked: 0, needsManual: 0, byCategory: {} };
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.byCategory[r.category] = (out.byCategory[r.category] || 0) + 1;
      if (r.status === 'blocked') out.blocked++;
      else if (r.status === 'needs-manual') out.needsManual++;
      else out.writable++;
    }
    return out;
  }
  /* The confirmation the bridge returns to the app: only ids of rows that are
     BOTH user-checked AND policy-selectable survive; everything else is
     reported under blocked/needsManual so the app cannot mistake silence for
     consent. */
  function selectionResult(model, checkedIds, confirmed) {
    var checked = {};
    (Array.isArray(checkedIds) ? checkedIds : []).forEach(function (id) { checked[text(id)] = true; });
    var selected = [], blocked = [], needsManual = [];
    for (var i = 0; i < model.rows.length; i++) {
      var r = model.rows[i];
      if (r.status === 'blocked') blocked.push(r.id);
      else if (r.status === 'needs-manual') needsManual.push(r.id);
      else if (checked[r.id]) selected.push(r.id);
    }
    return { ok: true, confirmed: confirmed === true, selected: confirmed === true ? selected : [], blocked: blocked, needsManual: needsManual, summary: model.summary };
  }

  /* ---------------- shadow-DOM renderer (content-script only) -------- */
  var CSS = [
    ':host{all:initial}',
    '.scrim{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483600;display:flex;align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,Segoe UI,Arial,sans-serif}',
    '.card{background:#fdfcf9;color:#1f2937;max-width:760px;width:min(94vw,760px);max-height:88vh;display:flex;flex-direction:column;border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.35);overflow:hidden}',
    '.hd{padding:16px 20px;border-bottom:1px solid #e5e1d8;background:#f6f3ec}',
    '.hd h1{font-size:16px;margin:0 0 4px;font-weight:700}',
    '.hd .who{font-size:13px;color:#4b5563}',
    '.hd .who b{color:#111827}',
    '.list{overflow-y:auto;padding:10px 16px;flex:1}',
    '.row{border:1px solid #e5e1d8;border-radius:10px;padding:10px 12px;margin:8px 0;background:#fff}',
    '.row.blocked{background:#faf7f2;opacity:.92}',
    '.rowhd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.rowhd label{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;cursor:pointer}',
    '.rowhd input{width:16px;height:16px}',
    '.chip{font-size:11px;font-weight:700;letter-spacing:.02em;padding:2px 8px;border-radius:999px;text-transform:uppercase}',
    '.chip.cat{background:#eef2ff;color:#3730a3}',
    '.chip.safe,.chip.selected{background:#dcfce7;color:#166534}',
    '.chip.blocked{background:#fee2e2;color:#991b1b}',
    '.chip.needs-manual{background:#fef3c7;color:#92400e}',
    '.dest{font-size:12px;color:#374151;margin-top:6px}',
    '.dest b{color:#111827}',
    '.note{font-size:12px;color:#6b7280;margin-top:4px}',
    '.prev{font-size:12px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px;margin-top:6px;white-space:pre-wrap;max-height:120px;overflow-y:auto}',
    '.ft{padding:14px 20px;border-top:1px solid #e5e1d8;background:#f6f3ec;display:flex;gap:10px;justify-content:flex-end;align-items:center}',
    '.ft .sum{margin-right:auto;font-size:12px;color:#4b5563}',
    'button{font:inherit;border-radius:8px;padding:9px 16px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-weight:600}',
    'button.primary{background:#166534;border-color:#166534;color:#fff}',
    'button.primary:disabled{background:#9ca3af;border-color:#9ca3af;cursor:not-allowed}',
    '.stopline{font-size:12px;color:#991b1b;font-weight:600;padding:0 20px 10px;background:#f6f3ec}'
  ].join('\n');

  function render(model, onDone, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.createElement) { if (onDone) onDone(selectionResult(model, [], false)); return null; }
    var prior = doc.getElementById('mls-review-screen-host');
    if (prior && prior.remove) prior.remove();
    var host = doc.createElement('div');
    host.id = 'mls-review-screen-host';
    var sh = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
    var style = doc.createElement('style'); style.textContent = CSS; sh.appendChild(style);

    var scrim = doc.createElement('div'); scrim.className = 'scrim';
    var card = doc.createElement('div'); card.className = 'card';
    var hd = doc.createElement('div'); hd.className = 'hd';
    var h1 = doc.createElement('h1'); h1.textContent = 'Review before anything is written to Athena';
    var who = doc.createElement('div'); who.className = 'who';
    var whoB = doc.createElement('b');
    whoB.textContent = model.patient.name || '(no patient)';
    who.appendChild(doc.createTextNode('Patient: '));
    who.appendChild(whoB);
    who.appendChild(doc.createTextNode(
      (model.patient.dob ? ' · DOB ' + model.patient.dob : '') +
      (model.patient.mrn ? ' · #' + model.patient.mrn : '') +
      (model.context.provider ? ' · Provider ' + model.context.provider : '') +
      (model.context.visitDate ? ' · Visit ' + model.context.visitDate : '')));
    hd.appendChild(h1); hd.appendChild(who); card.appendChild(hd);

    var stop = doc.createElement('div'); stop.className = 'stopline';
    stop.textContent = 'Orders, prescriptions, referrals, billing and diagnoses are PREVIEW ONLY here — the extension will not click Sign, Submit, Send, Approve, Finalize, Place order, Prescribe or Transmit.';
    card.appendChild(stop);

    var list = doc.createElement('div'); list.className = 'list';
    var checkboxes = {};
    model.rows.forEach(function (r) {
      var row = doc.createElement('div'); row.className = 'row' + (r.status === 'blocked' ? ' blocked' : '');
      var rowhd = doc.createElement('div'); rowhd.className = 'rowhd';
      var lbl = doc.createElement('label');
      if (r.selectable) {
        var cb = doc.createElement('input'); cb.type = 'checkbox'; cb.checked = r.checked === true;
        checkboxes[r.id] = cb; lbl.appendChild(cb);
      } else {
        var lock = doc.createElement('span'); lock.textContent = '🔒'; lbl.appendChild(lock);
      }
      lbl.appendChild(doc.createTextNode(r.title));
      rowhd.appendChild(lbl);
      var catChip = doc.createElement('span'); catChip.className = 'chip cat'; catChip.textContent = r.categoryLabel; rowhd.appendChild(catChip);
      var stChip = doc.createElement('span'); stChip.className = 'chip ' + r.status; stChip.textContent = r.statusLabel; rowhd.appendChild(stChip);
      row.appendChild(rowhd);
      var dest = doc.createElement('div'); dest.className = 'dest';
      var destB = doc.createElement('b'); destB.textContent = r.destination.sectionLabel;
      dest.appendChild(doc.createTextNode('Would go to: '));
      dest.appendChild(destB);
      dest.appendChild(doc.createTextNode(r.destination.taught ? ' (taught destination)' : ''));
      row.appendChild(dest);
      var note = doc.createElement('div'); note.className = 'note'; note.textContent = r.statusNote; row.appendChild(note);
      if (r.preview) { var prev = doc.createElement('div'); prev.className = 'prev'; prev.textContent = r.preview.slice(0, 1200); row.appendChild(prev); }
      list.appendChild(row);
    });
    card.appendChild(list);

    var ft = doc.createElement('div'); ft.className = 'ft';
    var sum = doc.createElement('div'); sum.className = 'sum';
    sum.textContent = model.summary.writable + ' writable · ' + model.summary.blocked + ' preview-only · ' + model.summary.needsManual + ' manual';
    var cancel = doc.createElement('button'); cancel.textContent = 'Cancel — write nothing';
    var confirm = doc.createElement('button'); confirm.className = 'primary';
    function checkedIds() { return Object.keys(checkboxes).filter(function (id) { return checkboxes[id].checked; }); }
    function refreshConfirm() {
      var n = checkedIds().length;
      confirm.textContent = n ? ('Confirm ' + n + ' selected note section' + (n === 1 ? '' : 's')) : 'Nothing selected';
      confirm.disabled = n === 0;
    }
    Object.keys(checkboxes).forEach(function (id) { checkboxes[id].addEventListener('change', refreshConfirm); });
    refreshConfirm();
    function finish(confirmed) {
      var result = selectionResult(model, checkedIds(), confirmed);
      if (host.remove) host.remove();
      if (onDone) onDone(result);
    }
    cancel.addEventListener('click', function () { finish(false); });
    confirm.addEventListener('click', function () { finish(true); });
    ft.appendChild(sum); ft.appendChild(cancel); ft.appendChild(confirm);
    card.appendChild(ft);
    scrim.appendChild(card);
    sh.appendChild(scrim);
    (doc.body || doc.documentElement).appendChild(host);
    return host;
  }

  root.MLSReviewScreen = {
    version: VERSION,
    buildReviewModel: buildReviewModel,
    summarizeModel: summarizeModel,
    selectionResult: selectionResult,
    render: render,
    STATUS_META: STATUS_META
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
