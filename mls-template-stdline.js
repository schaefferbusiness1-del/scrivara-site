/* mls-template-stdline.js — "Reusable standard line" for the Templates tab.
 *
 * Lets the doctor define a standard line once (e.g. a Decadron wastage statement)
 * and choose which saved templates ALWAYS include it. When a selected template is
 * used to generate / build a note, the line is auto-inserted into the
 * Medications / Description-of-Procedure area, non-duplicating.
 *
 * Self-contained, additive, reversible. Reuses the REAL template store
 * (getTemplates / setTemplates -> uns('templates')) and the REAL apply path
 * (applyTemplateToNote, which both maybeApplyTemplate and useTemplateNow call).
 * Does NOT mutate any stored template — the line is held in a separate
 * user-scoped store and merged into a CLONE of the template at apply time.
 *
 * Public surface: window.__mlsStdLine
 *   .installed (bool) .version (str)
 *   .getLines() .saveLines(arr)
 *   .insertLineIntoText(text, line)   // pure, exported for tests
 *   .isPresent(text, line)            // pure
 *   .augmentTemplateText(text, lines) // pure
 *   .revert()                         // unwrap + remove UI/style
 */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  if (window.__mlsStdLine && window.__mlsStdLine.installed) { return; }

  var STORE_KEY_SUFFIX = 'mlsStdLines';
  var STYLE_ID = 'mls-stdline-style';
  var SECTION_ID = 'mls-stdline-section';

  function uid() { return 'sl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

  function storeKey() {
    try {
      if (typeof window.uns === 'function') { return window.uns(STORE_KEY_SUFFIX); }
    } catch (e) {}
    return 'sf_u::_::' + STORE_KEY_SUFFIX;
  }
  function getLines() {
    try {
      var raw = localStorage.getItem(storeKey());
      if (!raw) { return []; }
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) { return []; }
      return arr.filter(function (x) { return x && typeof x === 'object' && typeof x.text === 'string'; })
        .map(function (x) {
          return {
            id: x.id || uid(),
            text: String(x.text),
            templateIds: Array.isArray(x.templateIds) ? x.templateIds.map(String) : [],
            created: x.created || Date.now()
          };
        });
    } catch (e) { return []; }
  }
  function saveLines(arr) {
    try {
      localStorage.setItem(storeKey(), JSON.stringify(Array.isArray(arr) ? arr : []));
      return true;
    } catch (e) { return false; }
  }

  function liveTemplates() {
    try {
      if (typeof window.getTemplates === 'function') {
        var t = window.getTemplates();
        return Array.isArray(t) ? t : [];
      }
    } catch (e) {}
    return [];
  }

  var TARGET_LABELS = [
    /medications?(?:\s+administered)?/i,
    /description\s+of\s+procedure/i,
    /procedure\s+note/i,
    /technique/i,
    /description/i,
    /procedure(?!\s*(?:note|codes|performed|s\b))/i
  ];

  function isPresent(text, line) {
    return norm(text).indexOf(norm(line)) !== -1;
  }

  function nextBoundaryIndex(text, fromIdx) {
    var cands = [];
    var re1 = /(?:\n+|\s{2,})([A-Z][A-Za-z0-9]*(?:[ \/\-](?:[A-Z][A-Za-z0-9]*|of|and|the|for))*)\s*:/g;
    re1.lastIndex = fromIdx;
    var m1 = re1.exec(text);
    if (m1) { cands.push(m1.index + m1[0].indexOf(m1[1])); }
    var re2 = /\n[ \t]*([A-Z][A-Z0-9 ()\/\-]{2,40})[ \t]*(?=\n|$)/g;
    re2.lastIndex = fromIdx;
    var m2 = re2.exec(text);
    if (m2) { cands.push(m2.index); }
    cands = cands.filter(function (i) { return i > fromIdx; });
    return cands.length ? Math.min.apply(null, cands) : -1;
  }

  function findTargetLabel(text) {
    for (var i = 0; i < TARGET_LABELS.length; i++) {
      var re = new RegExp('(?:^|\\n|\\s{2,})(' + TARGET_LABELS[i].source + ')\\s*:', 'i');
      var m = re.exec(text);
      if (m) { return { idx: m.index + m[0].length, label: m[1] }; }
      var re2 = new RegExp('(?:^|\\n)\\s*(' + TARGET_LABELS[i].source + ')\\s*(?:\\n|$)', 'i');
      var m2 = re2.exec(text);
      if (m2 && m2[1] === m2[1].toUpperCase()) { return { idx: m2.index + m2[0].length, label: m2[1] }; }
    }
    return null;
  }

  function sepFor(text) { return /\n/.test(text) ? '\n' : '  '; }

  function insertLineIntoText(text, line) {
    text = (text == null) ? '' : String(text);
    line = (line == null) ? '' : String(line).trim();
    if (!line) { return text; }
    if (isPresent(text, line)) { return text; }

    var sep = sepFor(text);
    var target = findTargetLabel(text);

    if (target) {
      var boundary = nextBoundaryIndex(text, target.idx);
      if (boundary !== -1) {
        var head = text.slice(0, boundary).replace(/\s+$/, '');
        var tail = text.slice(boundary).replace(/^\s+/, '');
        return head + sep + line + sep + tail;
      }
      return text.replace(/\s+$/, '') + sep + line;
    }

    if (/\n/.test(text)) { return text.replace(/\s+$/, '') + '\n\n' + line; }
    return text.replace(/\s+$/, '') + '  ' + line;
  }

  function augmentTemplateText(text, lines) {
    var out = (text == null) ? '' : String(text);
    (lines || []).forEach(function (ln) {
      var s = (typeof ln === 'string') ? ln : (ln && ln.text);
      if (s && String(s).trim()) { out = insertLineIntoText(out, String(s).trim()); }
    });
    return out;
  }

  function linesForTemplate(tid) {
    if (!tid) { return []; }
    return getLines().filter(function (l) { return l.templateIds.indexOf(String(tid)) !== -1; });
  }

  function installApplyWrap() {
    try {
      var orig = window.applyTemplateToNote;
      if (typeof orig !== 'function') { return false; }
      if (orig.__mlsStdLineWrapped) { return true; }
      var wrapped = function (template, visitText) {
        try {
          if (template && typeof template === 'object' && template.id) {
            var lines = linesForTemplate(template.id);
            if (lines.length) {
              var newText = augmentTemplateText(template.text || '', lines);
              if (newText !== (template.text || '')) {
                var clone = {};
                for (var k in template) { if (Object.prototype.hasOwnProperty.call(template, k)) { clone[k] = template[k]; } }
                clone.text = newText;
                return orig.call(this, clone, visitText);
              }
            }
          }
        } catch (e) {}
        return orig.call(this, template, visitText);
      };
      wrapped.__mlsStdLineWrapped = true;
      wrapped.__mlsStdLineOrig = orig;
      window.applyTemplateToNote = wrapped;
      return true;
    } catch (e) { return false; }
  }

  function uninstallApplyWrap() {
    try {
      var cur = window.applyTemplateToNote;
      if (cur && cur.__mlsStdLineWrapped && cur.__mlsStdLineOrig) { window.applyTemplateToNote = cur.__mlsStdLineOrig; }
    } catch (e) {}
  }

  function injectStyle() {
    try {
      if (document.getElementById(STYLE_ID)) { return; }
      var css = [
        '#' + SECTION_ID + '{border:1px solid #c9d6e5;background:#f4f8fd;border-radius:10px;',
        'padding:14px 14px 12px;margin:6px 0 16px;color:#13283f;font-size:13.5px;line-height:1.4;}',
        '#' + SECTION_ID + ' *{box-sizing:border-box;}',
        '#' + SECTION_ID + ' .mls-sl-h{font-weight:700;font-size:14.5px;color:#0f2d52;margin:0 0 2px;display:flex;align-items:center;gap:6px;}',
        '#' + SECTION_ID + ' .mls-sl-sub{color:#41566e;font-size:12px;margin:0 0 10px;}',
        '#' + SECTION_ID + ' label.mls-sl-lab{display:block;font-weight:600;color:#0f2d52;margin:8px 0 4px;font-size:12.5px;}',
        '#' + SECTION_ID + ' textarea.mls-sl-text{width:100%;min-height:60px;resize:vertical;border:1px solid #b4c6da;',
        'border-radius:7px;padding:8px 9px;font:inherit;color:#13283f;background:#fff;}',
        '#' + SECTION_ID + ' textarea.mls-sl-text:focus{outline:2px solid #2f6fb0;border-color:#2f6fb0;}',
        '#' + SECTION_ID + ' .mls-sl-tpls{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px;max-height:148px;overflow:auto;',
        'border:1px solid #d6e1ee;border-radius:7px;padding:8px;background:#fff;}',
        '#' + SECTION_ID + ' .mls-sl-chk{display:flex;align-items:center;gap:6px;background:#eef4fb;border:1px solid #cfe0f1;',
        'border-radius:6px;padding:4px 8px;font-size:12px;color:#13283f;cursor:pointer;user-select:none;}',
        '#' + SECTION_ID + ' .mls-sl-chk input{margin:0;cursor:pointer;}',
        '#' + SECTION_ID + ' .mls-sl-chk.on{background:#2f6fb0;border-color:#2f6fb0;color:#fff;}',
        '#' + SECTION_ID + ' .mls-sl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;}',
        '#' + SECTION_ID + ' .mls-sl-btn{border:0;border-radius:7px;padding:7px 14px;font:inherit;font-weight:600;',
        'cursor:pointer;background:#1f6f3f;color:#fff;}',
        '#' + SECTION_ID + ' .mls-sl-btn:hover{filter:brightness(1.06);}',
        '#' + SECTION_ID + ' .mls-sl-btn.ghost{background:transparent;color:#7a8aa0;font-weight:500;}',
        '#' + SECTION_ID + ' .mls-sl-mini{border:0;border-radius:6px;padding:4px 9px;font-size:12px;cursor:pointer;font-weight:600;}',
        '#' + SECTION_ID + ' .mls-sl-mini.edit{background:#e6edf5;color:#1c3a5e;}',
        '#' + SECTION_ID + ' .mls-sl-mini.del{background:#fbeaea;color:#9a2a2a;}',
        '#' + SECTION_ID + ' .mls-sl-list{margin-top:12px;border-top:1px dashed #c9d6e5;padding-top:10px;}',
        '#' + SECTION_ID + ' .mls-sl-item{background:#fff;border:1px solid #d6e1ee;border-radius:8px;padding:9px 10px;margin-bottom:8px;}',
        '#' + SECTION_ID + ' .mls-sl-item .txt{color:#13283f;font-size:12.5px;white-space:pre-wrap;word-break:break-word;}',
        '#' + SECTION_ID + ' .mls-sl-item .meta{margin-top:6px;display:flex;flex-wrap:wrap;gap:5px;align-items:center;}',
        '#' + SECTION_ID + ' .mls-sl-pill{background:#eaf3ea;border:1px solid #cfe6cf;color:#1f5a32;border-radius:20px;',
        'padding:2px 9px;font-size:11px;font-weight:600;}',
        '#' + SECTION_ID + ' .mls-sl-none{color:#7a8aa0;font-size:11.5px;font-style:italic;}',
        '#' + SECTION_ID + ' .mls-sl-actions{margin-left:auto;display:flex;gap:6px;}',
        '#' + SECTION_ID + ' .mls-sl-empty{color:#5a6c82;font-size:12px;font-style:italic;}',
        '#' + SECTION_ID + '.mls-sl-editing{outline:2px solid #2f6fb0;}'
      ].join('');
      var st = document.createElement('style');
      st.id = STYLE_ID; st.textContent = css;
      document.head.appendChild(st);
    } catch (e) {}
  }

  var editingId = null;

  function templateNameById(tid) {
    var ts = liveTemplates();
    for (var i = 0; i < ts.length; i++) { if (String(ts[i].id) === String(tid)) { return ts[i].name || '(unnamed)'; } }
    return '(deleted template)';
  }

  function buildSection() {
    var wrap = document.createElement('div');
    wrap.id = SECTION_ID;
    wrap.setAttribute('data-mls-asset', 'stdline');
    renderInto(wrap);
    return wrap;
  }

  function renderInto(wrap) {
    var tpls = liveTemplates();
    var lines = getLines();
    var editing = editingId ? (lines.filter(function (l) { return l.id === editingId; })[0] || null) : null;
    var checkedSet = {};
    if (editing) { editing.templateIds.forEach(function (id) { checkedSet[id] = true; }); }

    var tplBoxes = tpls.length
      ? tpls.map(function (t) {
          var on = checkedSet[t.id] ? ' on' : '';
          var ck = checkedSet[t.id] ? ' checked' : '';
          return '<label class="mls-sl-chk' + on + '" data-tid="' + esc(t.id) + '">' +
            '<input type="checkbox" data-tid="' + esc(t.id) + '"' + ck + '>' +
            '<span>' + esc(t.name || '(unnamed)') + '</span></label>';
        }).join('')
      : '<span class="mls-sl-none">No saved templates yet — add a template below first.</span>';

    var listHtml = lines.length
      ? lines.map(function (l) {
          var pills = l.templateIds.length
            ? l.templateIds.map(function (id) { return '<span class="mls-sl-pill">' + esc(templateNameById(id)) + '</span>'; }).join('')
            : '<span class="mls-sl-none">not assigned to any template</span>';
          return '<div class="mls-sl-item" data-id="' + esc(l.id) + '">' +
            '<div class="txt">' + esc(l.text) + '</div>' +
            '<div class="meta"><span style="font-size:11px;color:#5a6c82;font-weight:600;">Carried by:</span>' + pills +
            '<span class="mls-sl-actions">' +
            '<button type="button" class="mls-sl-mini edit" data-act="edit" data-id="' + esc(l.id) + '">Edit</button>' +
            '<button type="button" class="mls-sl-mini del" data-act="del" data-id="' + esc(l.id) + '">Remove</button>' +
            '</span></div></div>';
        }).join('')
      : '<div class="mls-sl-empty">No standard lines yet. Type one above, tick the templates that should always include it, and click Save standard line.</div>';

    wrap.innerHTML =
      '<div class="mls-sl-h">➕ Add a standard line to templates</div>' +
      '<div class="mls-sl-sub">Write a line once (e.g. a medication / wastage statement) and pick which templates always include it. ' +
      'It is auto-inserted into the Description / Procedure section when those templates build a note — never duplicated.</div>' +
      '<label class="mls-sl-lab" for="mls-sl-text">Standard line</label>' +
      '<textarea id="mls-sl-text" class="mls-sl-text" placeholder="e.g. Two Decadron (10 mg/cc) vials were used. 1.5 cc was injected and 0.5 cc was discarded.">' +
      esc(editing ? editing.text : '') + '</textarea>' +
      '<label class="mls-sl-lab">Always include this line in:</label>' +
      '<div class="mls-sl-tpls">' + tplBoxes + '</div>' +
      '<div class="mls-sl-row">' +
      '<button type="button" class="mls-sl-btn" data-act="save">' + (editing ? '💾 Update standard line' : '💾 Save standard line') + '</button>' +
      (editing ? '<button type="button" class="mls-sl-btn ghost" data-act="cancel">Cancel edit</button>' : '') +
      '</div>' +
      '<div class="mls-sl-list">' + listHtml + '</div>';

    if (editing) { wrap.classList.add('mls-sl-editing'); } else { wrap.classList.remove('mls-sl-editing'); }
    wireSection(wrap);
  }

  function wireSection(wrap) {
    wrap.querySelectorAll('.mls-sl-chk input[type=checkbox]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var lab = cb.closest('.mls-sl-chk');
        if (lab) { lab.classList.toggle('on', cb.checked); }
      });
    });
    wrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn || !wrap.contains(btn)) { return; }
      var act = btn.getAttribute('data-act');
      if (act === 'save') { onSave(wrap); }
      else if (act === 'cancel') { editingId = null; renderInto(wrap); }
      else if (act === 'edit') { editingId = btn.getAttribute('data-id'); renderInto(wrap); scrollTop(wrap); }
      else if (act === 'del') { onDelete(btn.getAttribute('data-id'), wrap); }
    });
  }

  function scrollTop(wrap) { try { wrap.scrollIntoView({ block: 'nearest' }); } catch (e) {} }

  function onSave(wrap) {
    try {
      var ta = wrap.querySelector('#mls-sl-text');
      var text = ta ? ta.value.trim() : '';
      if (!text) { try { ta.focus(); } catch (e) {} return; }
      var ids = [];
      wrap.querySelectorAll('.mls-sl-chk input[type=checkbox]').forEach(function (cb) {
        if (cb.checked) { ids.push(cb.getAttribute('data-tid')); }
      });
      var lines = getLines();
      if (editingId) {
        var found = false;
        lines = lines.map(function (l) {
          if (l.id === editingId) { found = true; return { id: l.id, text: text, templateIds: ids, created: l.created }; }
          return l;
        });
        if (!found) { lines.push({ id: uid(), text: text, templateIds: ids, created: Date.now() }); }
        editingId = null;
      } else {
        lines.push({ id: uid(), text: text, templateIds: ids, created: Date.now() });
      }
      saveLines(lines);
      renderInto(wrap);
    } catch (e) {}
  }

  function onDelete(id, wrap) {
    try {
      var lines = getLines().filter(function (l) { return l.id !== id; });
      saveLines(lines);
      if (editingId === id) { editingId = null; }
      renderInto(wrap);
    } catch (e) {}
  }

  function mountSection() {
    try {
      var modal = document.getElementById('templatesModal');
      if (!modal) { return; }
      if (modal.querySelector('#' + SECTION_ID)) { return; }
      var h3 = null;
      var hs = modal.querySelectorAll('h1,h2,h3');
      for (var i = 0; i < hs.length; i++) {
        if (/template/i.test(hs[i].textContent || '')) { h3 = hs[i]; break; }
      }
      var panel = h3 ? h3.parentElement : (modal.firstElementChild || modal);
      injectStyle();
      var section = buildSection();
      var anchor = h3 || null;
      if (anchor) {
        var sib = anchor.nextElementSibling;
        if (sib && sib.tagName === 'P') { anchor = sib; }
        anchor.insertAdjacentElement('afterend', section);
      } else {
        panel.insertBefore(section, panel.firstChild);
      }
    } catch (e) {}
  }

  function installOpenWrap() {
    try {
      var orig = window.openTemplates;
      if (typeof orig !== 'function') { return false; }
      if (orig.__mlsStdLineWrapped) { return true; }
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        try { setTimeout(mountSection, 0); setTimeout(mountSection, 120); } catch (e) {}
        return r;
      };
      wrapped.__mlsStdLineWrapped = true;
      wrapped.__mlsStdLineOrig = orig;
      window.openTemplates = wrapped;
      return true;
    } catch (e) { return false; }
  }
  function uninstallOpenWrap() {
    try {
      var cur = window.openTemplates;
      if (cur && cur.__mlsStdLineWrapped && cur.__mlsStdLineOrig) { window.openTemplates = cur.__mlsStdLineOrig; }
    } catch (e) {}
  }

  function revert() {
    try {
      uninstallApplyWrap();
      uninstallOpenWrap();
      var sec = document.getElementById(SECTION_ID); if (sec && sec.parentNode) { sec.parentNode.removeChild(sec); }
      var st = document.getElementById(STYLE_ID); if (st && st.parentNode) { st.parentNode.removeChild(st); }
      if (window.__mlsStdLine) { window.__mlsStdLine.installed = false; }
    } catch (e) {}
  }

  function install() {
    var a = installApplyWrap();
    var b = installOpenWrap();
    try { if (document.getElementById('templatesModal')) { mountSection(); } } catch (e) {}
    return a && b;
  }

  function installWithRetry() {
    if (install()) { return; }
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (install() || tries >= 40) { clearInterval(timer); }
    }, 250);
  }

  window.__mlsStdLine = {
    installed: true,
    version: VERSION,
    getLines: getLines,
    saveLines: saveLines,
    insertLineIntoText: insertLineIntoText,
    isPresent: isPresent,
    augmentTemplateText: augmentTemplateText,
    linesForTemplate: linesForTemplate,
    mount: mountSection,
    revert: revert
  };

  try {
    installWithRetry();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install, { once: true });
    }
  } catch (e) { try { install(); } catch (e2) {} }
})();
