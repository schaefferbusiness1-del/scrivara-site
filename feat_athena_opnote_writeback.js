/* feat_athena_opnote_writeback.js  ->  window.__mlsOpWb  (opwb-1.0.0)
 * --------------------------------------------------------------------------
 * OP-NOTE WRITEBACK to the EXACT athenaOne location (the learned path):
 *   PE -> Procedure Documentation -> add the chosen procedure template
 *   ("Injection Generic Template") -> ERASE the skeleton -> INSERT the op-note.
 *
 * HOW IT WORKS (no new write primitive; reuses the proven, gated paste):
 *   1. Reads WHERE op-notes should go from window.__mlsWbRouter ('opnote'):
 *      tab / section / template (the doctor can change this in plain English).
 *   2. Sends mlsAppPrepProcTemplate to MLS Assist, which drives athenaOne to ADD
 *      that template so the editable box exists (the box does not exist until
 *      the template is added). PROBE mode is read-only; PREP mode clicks
 *      navigation only -- NEVER Save/Sign.
 *   3. Only once the box is READY, hands the op-note text to the existing
 *      window.__mlsAthenaWriteback.writeNoteToChart(), which runs the name+DOB
 *      patient-match GATE and the verified paste. The paster does select-all +
 *      insertText on the contenteditable box = ERASE the skeleton, INSERT the
 *      op-note. The doctor reviews + signs; MLS never signs.
 *
 * HONEST STATUS: it reports "added the template" / "wrote the op-note" only on
 * genuine, confirmed results from the extension. If prep fails (e.g. the encounter
 * is not open) it says exactly which step and stops -- no fake success.
 *
 * Additive, idempotent, reversible (window.__mlsOpWb.revert()). ASCII-only.
 * Requires MLS Assist v1.39+ (the mlsAppPrepProcTemplate handler). On older
 * extensions it detects the missing handler and tells the doctor to reload.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsOpWb && window.__mlsOpWb.installed) return; } catch (e) { return; }
  var VERSION = 'opwb-1.0.0';
  var STYLE_ID = 'mlsOpWbStyle';

  function g(n) { try { return window[n]; } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function router() { return g('__mlsWbRouter'); }
  function opnoteTarget() {
    var r = router();
    if (r && isFn(r.get)) { var t = safe(function () { return r.get('opnote'); }, null); if (t) return t; }
    return { tab: 'PE', sectionName: 'Procedure Documentation', section: 'procedure', template: 'Injection Generic Template', addTemplate: true, clearFirst: true, label: 'PE > Procedure Documentation > "Injection Generic Template"' };
  }

  /* ---- the op-note text the doctor reviewed (prefer the operative-note body) ---- */
  function opNoteText(explicit) {
    if (trim(explicit)) return String(explicit);
    var ids = ['procNoteBody', 'noteBox', 'viewBody'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) { var v = trim(el.value != null ? el.value : el.textContent); if (v) return v; }
    }
    return '';
  }

  /* ---- shared timeline (status + WRITE badge) via the the shared module ---- */
  function AA() { return g('__mlsAthenaActions'); }
  function openTL() { var a = AA(); if (a && isFn(a._openTimeline)) safe(function () { a._openTimeline({ title: 'Write op-note to Athena', intent: { brings: 'Adds the procedure template, then writes the op-note into it (does NOT sign)', mode: 'write' } }); }); }
  function step(text, state) { var a = AA(); if (a && isFn(a._step)) return safe(function () { return a._step(text, state); }, null); var t = g('toast'); if (isFn(t)) safe(function () { t(String(text), (state === 'fail' || state === 'warn') ? 'err' : ''); }); return null; }
  function panel() { return safe(function () { return document.querySelector('.mlsaa-tl'); }, null); }
  function finishFail(msg, fix) { step(msg, 'fail'); var p = panel(); if (!p) { if (fix) step('Fix: ' + fix, 'warn'); return; } var d = p.querySelector('.mlsaa-done'); if (d) { d.textContent = msg; d.className = 'mlsaa-done fail'; d.removeAttribute('hidden'); } var f = p.querySelector('.mlsaa-fix'); if (f && fix) { f.textContent = 'Fix: ' + fix; f.removeAttribute('hidden'); } }

  /* ---- bridge to MLS Assist (ping-gated) ---- */
  function bridge(reqType, payload, resultType, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false, ponged = false, tries = 0, iv = null, to = null;
      function cleanup() { try { window.removeEventListener('message', onMsg); } catch (e) {} if (iv) clearInterval(iv); if (to) clearTimeout(to); }
      function finish(resp) { if (done) return; done = true; cleanup(); resolve(resp || {}); }
      function onMsg(e) { var d = e && e.data; if (!d || d.source !== 'mls-ext') return; if (d.type === 'mlsPong' && !ponged) { ponged = true; if (iv) clearInterval(iv); send(); return; } if (d.type === resultType) finish(d.resp || { error: 'no response' }); }
      function send() { safe(function () { window.postMessage(Object.assign({ source: 'mls-app', type: reqType }, payload || {}), '*'); }); }
      function ping() { safe(function () { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); }); }
      window.addEventListener('message', onMsg);
      ping();
      iv = setInterval(function () { tries++; if (ponged) { clearInterval(iv); return; } if (tries > 8) { clearInterval(iv); finish({ error: 'noext' }); } else ping(); }, 350);
      to = setTimeout(function () { finish({ error: 'timeout' }); }, timeoutMs || 45000);
    });
  }

  function prepStepMsg(step) {
    return { 'present': 'The procedure template is already open.', 'section-had-box': 'Procedure Documentation is open with the template box.',
      'added': 'Added the procedure template.', 'section': 'Could not reach Procedure Documentation from the tab.',
      'pick': 'Could not find the template to add.', 'render': 'The template was added but its editable box did not appear.' }[step] || '';
  }

  /* ---- the op-note write flow ---- */
  var running = false;
  function writeOpNote(opts) {
    opts = opts || {};
    if (running) return; running = true;
    var done = function () { running = false; };
    var note = opNoteText(opts.note);
    var tgt = opnoteTarget();
    openTL();
    if (!trim(note)) { finishFail('No op-note text to write - generate or open the operative note first.', 'Generate the op-note, then click "Write op-note to Athena".'); return done(); }

    var where = tgt.label || (tgt.tab + ' > ' + tgt.sectionName + ' > "' + tgt.template + '"');
    step('This op-note will go to: ' + where + '.', 'note');
    step('Preparing the template in athenaOne (' + esc(tgt.sectionName) + ' > "' + esc(tgt.template) + '")...', 'run');

    var params = { tab: tgt.tab, sectionName: tgt.sectionName, section: tgt.section, template: tgt.template };
    bridge('mlsAppPrepProcTemplate', { params: params, mode: 'prep' }, 'mlsAppPrepProcTemplateResult', 60000).then(function (resp) {
      resp = resp || {};
      if (resp.error === 'noext' || resp.error === 'timeout') { finishFail('MLS Assist did not respond - the op-note was NOT written.', 'Enable/reload MLS Assist (Settings > Get the extension; needs v1.39+), open the encounter, then try again.'); return done(); }
      if (resp.unhandled || /unknown|no handler/i.test(String(resp.error || ''))) { finishFail('Your MLS Assist is older than v1.39 and cannot add the procedure template yet.', 'Update MLS Assist from Settings > Get the extension and reload it at chrome://extensions, then try again.'); return done(); }
      if (!resp.ready) {
        var sm = prepStepMsg(resp.step) || resp.msg || 'Could not open the procedure template.';
        finishFail('Could not prepare the template (' + esc(sm) + ') - nothing was written.', resp.step === 'section' ? 'Open the patient encounter and the PE tab in athenaOne, then try again.' : 'Open the patient encounter in athenaOne, then try again.');
        return done();
      }
      step(resp.alreadyPresent ? 'Template already open - inserting the op-note.' : 'Template ready - inserting the op-note (erasing the skeleton).', 'ok');

      // Hand off to the EXISTING gated, verified paste. It runs the name+DOB match gate,
      // then select-all + insertText into the procedure box (erase skeleton -> insert note),
      // confirms it landed, and offers Review & Sign. MLS never signs.
      var wb = g('__mlsAthenaWriteback');
      if (wb && isFn(wb.writeNoteToChart)) { safe(function () { wb.writeNoteToChart({ note: note }); }); done(); return; }
      finishFail('The verified-write module is not loaded.', 'Reload the MLS page and try again.');
      done();
    }, function () { finishFail('Could not run the template-prep step.', 'Reload MLS Assist and try again.'); done(); });
  }

  /* ---- read-only PROBE: confirm the path/selectors without any clicks ---- */
  function probe() {
    var tgt = opnoteTarget();
    return bridge('mlsAppPrepProcTemplate', { params: { tab: tgt.tab, sectionName: tgt.sectionName, section: tgt.section, template: tgt.template }, mode: 'probe' }, 'mlsAppPrepProcTemplateResult', 20000);
  }

  /* ---- button injection ---- */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = '.mlsopwb-btn{cursor:pointer;font-weight:600;padding:9px 14px;border-radius:10px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;margin-top:8px}' +
      '.mlsopwb-cap{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#475569;margin-left:8px}' +
      '.mlsopwb-tag{display:inline-block;font-weight:700;font-size:10px;letter-spacing:.04em;padding:2px 6px;border-radius:6px;background:#ede9fe;color:#5b21b6;border:1px solid #a78bfa}';
    (document.head || document.documentElement).appendChild(s);
  }
  function makeBtn(suffix) {
    var b = document.createElement('button'); b.type = 'button'; b.id = 'mlsOpWbBtn' + suffix; b.className = 'mlsopwb-btn'; b.setAttribute('data-mlsopwb', '1');
    b.textContent = 'Write op-note to Athena (Procedure Documentation)';
    b.title = 'Adds the procedure template, erases the skeleton, inserts the op-note. Does NOT sign.';
    b.addEventListener('click', function (ev) { ev.preventDefault(); writeOpNote({}); });
    return b;
  }
  function injectButtons() {
    safe(function () {
      var host = document.getElementById('procNoteCard') || document.getElementById('procNoteBody');
      if (host && !document.getElementById('mlsOpWbBtnProc')) {
        var anchor = document.getElementById('procNoteBody') || host;
        var wrap = document.createElement('div'); wrap.setAttribute('data-mlsopwb', '1');
        wrap.appendChild(makeBtn('Proc'));
        var cap = document.createElement('span'); cap.className = 'mlsopwb-cap';
        cap.innerHTML = '<span class="mlsopwb-tag">WRITES TO CHART</span> ' + esc(opnoteTarget().label || 'Procedure Documentation');
        wrap.appendChild(cap);
        (anchor.parentNode || host).insertBefore(wrap, anchor.nextSibling);
      }
    });
  }

  var mo = null, retimer = null;
  function scheduleInject() { if (retimer) return; retimer = setTimeout(function () { retimer = null; injectButtons(); }, 300); }
  function boot() { ensureStyle(); injectButtons(); try { mo = new MutationObserver(scheduleInject); mo.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch (e) {} }
  function revert() {
    try { if (mo) mo.disconnect(); } catch (e) {} mo = null; if (retimer) { clearTimeout(retimer); retimer = null; }
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); });
    safe(function () { [].slice.call(document.querySelectorAll('[data-mlsopwb]')).forEach(function (n) { n.remove ? n.remove() : (n.parentNode && n.parentNode.removeChild(n)); }); });
    try { window.__mlsOpWb.installed = false; } catch (e) {}
  }

  window.__mlsOpWb = { installed: true, version: VERSION, asset: 'feat_athena_opnote_writeback.js', writeOpNote: writeOpNote, probe: probe, opnoteTarget: opnoteTarget, _opNoteText: opNoteText, injectButtons: injectButtons, revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
