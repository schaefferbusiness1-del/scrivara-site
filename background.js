// MLS Assist — background worker. Only place that holds the API key + talks to MLS. (v1.7 robust executor)
const DEFAULT_BACKEND = 'https://scrivara-backend.onrender.com';
// Maps each global element #index → { frameId, localIndex } so the autopilot can
// read AND act inside iframes (e.g. athenaNet, which is heavily iframed). Rebuilt
// on every mlsAssistElements call, consumed by mlsAssistExec for #index targets.
const _mlsFrameMap = {};

// ===========================================================================
// MLS Assist NOTE WRITE-BACK ENGINE (v1.27 — "section router + verified typing
// + patient-match gate"). Injected page-context helpers + worker-scope pure
// helpers used by the panel "Insert into chart" path and the app-driven paste.
//
// Three pillars (per Michael):
//   1) RELIABLE TYPING — one verified primitive (mlsRobustType): native value
//      setter / execCommand + framework events, then simulated paste, then
//      per-character keystrokes, RE-READING the field after each so we never
//      claim success on a controlled input that silently rejected the write.
//   2) SMART FIELD ROUTING — classify the MLS content into an athenaOne section
//      (insurance / diagnoses[ICD-10] / orders[CPT] / procedure / assessment&plan
//      / hpi / physical exam / ros / note) and find the field whose LABEL + SECTION
//      HEADING context matches — insurance never lands in the note body, codes
//      never land in free-text. Reports exactly which field each piece went to.
//   3) PATIENT SAFETY GATE — before ANY write, read the MLS active patient and the
//      open Athena chart identity (name/DOB/MRN) and MATCH. Write only on a
//      confident match; otherwise refuse and warn. (mlsReadChartIdentity /
//      mlsReadActivePatient / mlsMatchPatients.)
// NOTHING here ever clicks Save/Sign — these only fill fields.
// ===========================================================================

// ---- Section label patterns (how a field's section context is recognized) ----
// Duplicated inside injected functions because injected funcs must be self-contained.
function _mlsSectDefs() {
  return [
    { key:'insurance',       label:'Insurance',
      fieldRe:/insuranc|payer|payor|subscriber|policy|member\s*id|group\s*(number|no|#)|coverage|guarantor|plan\s*name/,
      sigs:['insurance:','primary insurance','secondary insurance','payer:','payor:','policy number','policy #','policy no','member id','group number','group #','subscriber','copay','co-pay','deductible','medicare','medicaid','bcbs','blue cross','aetna','cigna','unitedhealth','united health','umr','humana','tricare'] },
    { key:'diagnoses',       label:'Diagnoses (ICD-10)',
      fieldRe:/diagnos|\bicd\b|icd-?10|problem\s*list/,
      sigs:['icd-10','icd10','icd-10-cm','diagnosis:','diagnoses:','dx:','problem list','assessment codes'] },
    { key:'orders',          label:'Orders / Procedure codes (CPT)',
      fieldRe:/orders?\b|\bcpt\b|procedure\s*code|hcpcs|billing|charge|superbill|e&m|e\/m/,
      sigs:['cpt:','cpt code','cpt-','hcpcs','procedure code','billing code','charge:','superbill','e/m level','e&m level','order:','orders:'] },
    { key:'procedure',       label:'Procedure Documentation',
      fieldRe:/procedur|operativ|op.?note|injection|fluoro|epidural|nerve\s*block|\bblock\b|aspiration|biopsy|arthrocentesis|implant|anesthesia|\btemplate\b|\besi\b|\bmbb\b|\brfa\b|surg|document/,
      sigs:['preoperative diagnos','pre-operative diagnos','postoperative diagnos','post-operative diagnos','description of procedure','procedure performed','date of operation','indications for the procedure','indications for procedure','estimated blood loss','operative note','op note','fluorosc','needle','epidural steroid','transforaminal','medial branch','radiofrequency','local anesth','under anesthesia','informed consent was obtained','time out','sterile prep','type of anesthesia'] },
    { key:'assessment_plan', label:'Assessment & Plan',
      fieldRe:/assess|\bplan\b|impression|a&p|a\/p|decision\s*making/,
      sigs:['assessment:','impression:','plan:','differential','we will','recommend','refer to','follow up in','follow-up in','medical decision'] },
    { key:'hpi',             label:'HPI',
      fieldRe:/\bhpi\b|history of present|present illness|subjective|chief complaint|interval history/,
      sigs:['chief complaint','history of present illness','hpi:','presents with','complains of','since the last visit','interval history'] },
    { key:'physical_exam',   label:'Physical Exam',
      fieldRe:/physical exam|\bpe\b|\bexam\b|objective|findings/,
      sigs:['physical exam','on exam','inspection:','palpation','range of motion','tenderness','motor strength','reflexes','straight leg raise','gait','5/5'] },
    { key:'ros',             label:'Review of Systems',
      fieldRe:/review of systems|\bros\b/,
      sigs:['review of systems','ros:','denies fever','denies chest pain','constitutional:'] },
    { key:'progress',        label:'Note',
      fieldRe:/note|progress|narrative|free.?text|encounter|impression|document|hpi|assess|plan/,
      sigs:[] }
  ];
}

// Classify note text -> best target section key. Priority order makes a whole
// op/procedure note win when present; pure code/insurance blocks route to their field.
function mlsRouteSection(text) {
  var t = String(text || '').toLowerCase();
  var defs = _mlsSectDefs();
  var order = ['procedure','insurance','orders','diagnoses','assessment_plan','hpi','physical_exam','ros'];
  var scores = {};
  defs.forEach(function (d) { var n = 0; d.sigs.forEach(function (s) { if (t.indexOf(s) >= 0) n++; }); scores[d.key] = n; });
  // bare ICD-10 codes (e.g. M54.16) boost diagnoses; 5-digit CPT (e.g. 64483) boost orders
  if (/\b[a-tv-z][0-9][0-9ab](\.[0-9a-z]{1,4})?\b/i.test(text || '')) scores.diagnoses += 1;
  if (/\b(99[0-2]\d{2}|6[24]\d{3}|20\d{3}|72\d{3})\b/.test(text || '')) scores.orders += 1;
  var bestK = 'progress', bestN = 0;
  order.forEach(function (k) { if (scores[k] > bestN) { bestN = scores[k]; bestK = k; } });
  if (bestN < 2) bestK = 'progress';
  return { section: bestK, strength: bestN, scores: scores };
}

// Split a structured MLS note into labeled segments so each part is routed to the
// matching Athena field (insurance->insurance, ICD-10->diagnoses, CPT->orders,
// op-note narrative->Procedure Documentation, etc.). If no headers are recognized,
// returns a single segment routed by mlsRouteSection. Pure/worker-scope (testable).
function mlsSegmentNote(text) {
  var src = String(text || '');
  if (!src.trim()) return [];
  // An op/procedure note is ONE document — keep it whole, route to Procedure Documentation.
  if (mlsRouteSection(src).section === 'procedure') return [{ section: 'procedure', text: src }];
  var headerMap = [
    { re:/^\s*(insurance|primary insurance|payer|payor|coverage)\s*[:\-]/i, section:'insurance' },
    { re:/^\s*(icd-?10|icd-?10-cm|diagnos(is|es)|dx)\s*[:\-]/i, section:'diagnoses' },
    { re:/^\s*(cpt|cpt codes?|procedure codes?|hcpcs|orders?|billing|charges?)\s*[:\-]/i, section:'orders' },
    { re:/^\s*(procedure|operative note|op note|procedure note|procedure documentation|description of procedure)\s*[:\-]/i, section:'procedure' },
    { re:/^\s*(assessment( and plan| ?& ?plan)?|impression|a\/p|a&p)\s*[:\-]/i, section:'assessment_plan' },
    { re:/^\s*(plan)\s*[:\-]/i, section:'assessment_plan' },
    { re:/^\s*(hpi|history of present illness|subjective|chief complaint|cc)\s*[:\-]/i, section:'hpi' },
    { re:/^\s*(physical exam(ination)?|objective|exam)\s*[:\-]/i, section:'physical_exam' },
    { re:/^\s*(review of systems|ros)\s*[:\-]/i, section:'ros' }
  ];
  var lines = src.split(/\r?\n/);
  var segs = [], cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var matchedSection = null;
    for (var h = 0; h < headerMap.length; h++) { if (headerMap[h].re.test(line)) { matchedSection = headerMap[h].section; break; } }
    if (matchedSection) {
      if (cur) segs.push(cur);
      cur = { section: matchedSection, text: line };
    } else if (cur) {
      cur.text += '\n' + line;
    } else {
      cur = { section: null, text: line };
    }
  }
  if (cur) segs.push(cur);
  // collapse: if 0 or 1 recognized header, treat whole note as one routed segment
  var recognized = segs.filter(function (s) { return s.section; }).length;
  if (recognized <= 1) {
    var r = mlsRouteSection(src);
    return [{ section: r.section, text: src }];
  }
  // any leading unlabeled chunk -> route by its own content
  segs = segs.map(function (s) { if (!s.section) { s.section = mlsRouteSection(s.text).section; } s.text = s.text.replace(/\s+$/,''); return s; }).filter(function (s) { return s.text.trim(); });
  var merged = [];
  segs.forEach(function (s) { var last = merged[merged.length - 1]; if (last && last.section === s.section) { last.text += '\n' + s.text; } else { merged.push({ section: s.section, text: s.text }); } });
  return merged;
}

// ---- Robust, VERIFIED text entry primitive (injected). Single source of truth. ----
// v1.28 — hardened against the modes the autopilot log flagged ("read-only, masked, or a
// typeahead that needs a selection"): resolves a real EDITABLE field from a label/wrapper,
// clicks+focuses first, native-setter + bubbling input/change (execCommand insertText for
// contenteditable), simulated paste, per-character keystrokes that drive MASKED inputs,
// then SELECTS the matching item from any TYPEAHEAD list, and re-reads to CONFIRM after a
// settle + blur. Returns confirmed:false + stuck:true with a reason when nothing sticks.
async function mlsRobustType(el, txt) {
  txt = String(txt == null ? '' : txt);
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function _isEd(e) { if (!e || !e.tagName) return false; if (e.isContentEditable) return true; var tg = e.tagName.toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') { var t = (e.getAttribute('type') || 'text').toLowerCase(); return /^(text|search|email|url|tel|number|password|date|month|week|time|datetime-local|)$/.test(t); } return false; }
  function _resolve(e) { if (_isEd(e)) return e; if (!e || !e.tagName) return e; try { if (e.tagName.toUpperCase() === 'LABEL') { var f = e.getAttribute('for'); if (f) { var byId = document.getElementById(f); if (_isEd(byId)) return byId; } var within = e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(within)) return within; } } catch (e2) {} try { var n = e.querySelector && e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(n)) return n; } catch (e3) {} try { var sib = e.nextElementSibling, k = 0; while (sib && k < 3) { if (_isEd(sib)) return sib; var inS = sib.querySelector && sib.querySelector('input:not([type=hidden]),textarea,[contenteditable]'); if (_isEd(inS)) return inS; sib = sib.nextElementSibling; k++; } } catch (e4) {} try { var p = e.parentElement, d = 0; while (p && d < 3) { var inp = p.querySelector && p.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(inp)) return inp; p = p.parentElement; d++; } } catch (e5) {} return e; }
  el = _resolve(el);
  if (!el || !_isEd(el)) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'no-field', into: 0 };
  if (el.readOnly || el.disabled) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'readonly', into: 0 };
  var CE = !!el.isContentEditable;
  function rd() { return CE ? (el.innerText || el.textContent || '') : (el.value || ''); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function isMasked() { try { if (CE) return false; var t = (el.getAttribute('type') || '').toLowerCase(); if (t === 'date' || t === 'tel') return true; var ph = el.getAttribute('placeholder') || ''; if (/[\/\-.]/.test(ph) && /[mdyhMDYH#0_]/.test(ph)) return true; if (el.getAttribute('inputmode') === 'numeric') return true; if (el.getAttribute('data-mask') || el.getAttribute('pattern')) return true; var ml = el.maxLength; if (ml && ml > 0 && ml <= 12 && /[\/\-.]/.test(ph)) return true; } catch (e) {} return false; }
  var masked = isMasked();
  function landed() { var cur = rd(); if (!cur && txt) return false; var a = norm(cur), b = norm(txt); if (!b) return true; if (a.indexOf(b.slice(0, Math.min(b.length, 40))) >= 0) return true; if (masked) { var dc = digits(cur), dt = digits(txt); if (dt && dc.indexOf(dt) >= 0) return true; } return cur.replace(/\s+/g, '').length >= Math.min(txt.replace(/\s+/g, '').length, 15); }
  function setNative(v) { if (CE) { try { el.textContent = v; } catch (e) {} return; } var pr = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }
  function fireInput(data, type) { try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {} } }
  function clearField() { try { if (!CE && el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {} setNative(''); fireInput('', 'deleteContentBackward'); }
  function _vis(e) { try { var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e2) { return true; } }
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  try { el.click(); } catch (e) {}
  try { el.focus(); } catch (e) {}
  await sleep(0);
  async function keystroke() { clearField(); for (var i = 0; i < txt.length; i++) { var ch = txt.charAt(i); try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true })); } catch (e) {} if (CE) { var ok; try { ok = document.execCommand('insertText', false, ch); } catch (e) { ok = false; } if (!ok) setNative(rd() + ch); } else { var base = (el.value != null) ? el.value : ''; setNative(base + ch); } fireInput(ch, 'insertText'); try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } catch (e) {} await sleep(masked ? 18 : 6); } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
  async function pickSuggestion() { await sleep(320); var opts = []; var ac = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')); if (ac) { var box = document.getElementById(ac); if (box) opts = [].slice.call(box.querySelectorAll('[role=option],li,.option,.item')).filter(_vis); } if (!opts.length) opts = [].slice.call(document.querySelectorAll('[role=option],[role=listbox] li,.autocomplete-item,.suggestion,.typeahead-option,ul[class*=auto] li,ul[class*=suggest] li,li[class*=option]')).filter(_vis); if (!opts.length) { var lists = [].slice.call(document.querySelectorAll('ul,ol,[role=listbox],[role=menu]')).filter(_vis); for (var L = 0; L < lists.length && !opts.length; L++) { var items = [].slice.call(lists[L].querySelectorAll('li,[role=option],[role=menuitem]')).filter(_vis); if (items.length && items.length <= 25) opts = items; } } if (!opts.length) return { picked: false }; var want = norm(txt), pick = null; for (var i = 0; i < opts.length; i++) { if (norm(opts[i].textContent).indexOf(want) >= 0) { pick = opts[i]; break; } } if (!pick) pick = opts[0]; if (!pick) return { picked: false }; try { pick.scrollIntoView({ block: 'center' }); } catch (e) {} var r = pick.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {} }); try { pick.click(); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {} await sleep(150); return { picked: true, label: (pick.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) }; }
  var method = '';
  if (!masked) {
    try { try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {} if (CE) { try { var rg = document.createRange(); rg.selectNodeContents(el); var se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt })); } catch (e) {} var _ec; try { _ec = document.execCommand('insertText', false, txt); } catch (e) { _ec = false; } if (!_ec) setNative(txt); } else { clearField(); setNative(txt); } fireInput(txt, 'insertText'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {} } catch (e) {}
    await sleep(0); if (landed()) method = 'native';
    if (!method) { try { var dt = new DataTransfer(); dt.setData('text/plain', txt); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); fireInput(txt, 'insertFromPaste'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } catch (e) {} await sleep(0); if (landed()) method = 'paste'; }
  }
  if (!method && txt.length <= 4000) { try { await keystroke(); } catch (e) {} if (landed()) method = masked ? 'mask' : 'keystroke'; }
  var sug = { picked: false }; try { sug = await pickSuggestion(); } catch (e) {}
  if (sug.picked) { await sleep(60); method = method || (landed() ? 'typeahead' : 'typeahead-selected'); }
  await sleep(120);
  if (!landed()) { try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} await sleep(80); }
  if (landed()) return { ok: true, confirmed: true, stuck: false, method: method || 'native', into: rd().length, picked: !!sug.picked, pickedLabel: sug.label || '' };
  if (sug.picked) return { ok: true, confirmed: false, stuck: false, method: 'typeahead-selected', into: rd().length, picked: true, pickedLabel: sug.label || '', reason: 'selected-suggestion-unconfirmed' };
  return { ok: false, confirmed: false, stuck: true, method: 'unconfirmed', into: rd().length, reason: masked ? 'masked-rejected' : 'not-stuck' };
}

// ---- Field scanner (injected, read-only): score editable fields for a target section ----
function mlsFieldScanner(noteText, forcedSection) {
  function vis(el) { try { if (el.disabled || el.readOnly) return false; var s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < .05) return false; var r = el.getBoundingClientRect(); return r.width > 110 && r.height > 18; } catch (e) { return false; } }
  function ownLabel(el) { try { var l = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'))) || ''; if (!l && el.id) { var lb = document.querySelector('label[for="' + el.id + '"]'); if (lb) l = (lb.textContent || '').trim(); } return String(l).replace(/\s+/g, ' ').trim().slice(0, 48); } catch (e) { return ''; } }
  function sectionHeading(el) { try { var n = el, hops = 0; while (n && hops < 5) { n = n.parentElement; hops++; if (!n) break; var hd = n.querySelector && n.querySelector('h1,h2,h3,h4,h5,h6,legend,[role="heading"]'); if (hd) { var ht = (hd.textContent || '').trim(); if (ht && ht.length <= 64) return ht.replace(/\s+/g, ' '); } var al = n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('data-section') || n.getAttribute('data-sectionname')); if (al && al.length <= 64) return String(al).replace(/\s+/g, ' '); } } catch (e) {} return ''; }
  function hay(el) { var h = ownLabel(el) + ' ' + sectionHeading(el); try { var n = el, hops = 0; while (n && hops < 4) { n = n.parentElement; hops++; if (!n) break; var al = n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('data-section') || n.getAttribute('data-sectionname') || n.getAttribute('title')); if (al) h += ' ' + al; } } catch (e) {} return String(h).toLowerCase(); }
  var DEFS = (function () { return [
    { key:'insurance', label:'Insurance', fieldRe:/insuranc|payer|payor|subscriber|policy|member\s*id|group\s*(number|no|#)|coverage|guarantor|plan\s*name/ },
    { key:'diagnoses', label:'Diagnoses (ICD-10)', fieldRe:/diagnos|\bicd\b|icd-?10|problem\s*list/ },
    { key:'orders', label:'Orders / Procedure codes (CPT)', fieldRe:/orders?\b|\bcpt\b|procedure\s*code|hcpcs|billing|charge|superbill|e&m|e\/m/ },
    { key:'procedure', label:'Procedure Documentation', fieldRe:/procedur|operativ|op.?note|injection|fluoro|epidural|nerve\s*block|\bblock\b|aspiration|biopsy|arthrocentesis|implant|anesthesia|\btemplate\b|\besi\b|\bmbb\b|\brfa\b|surg|document/ },
    { key:'assessment_plan', label:'Assessment & Plan', fieldRe:/assess|\bplan\b|impression|a&p|a\/p|decision\s*making/ },
    { key:'hpi', label:'HPI', fieldRe:/\bhpi\b|history of present|present illness|subjective|chief complaint|interval history/ },
    { key:'physical_exam', label:'Physical Exam', fieldRe:/physical exam|\bpe\b|\bexam\b|objective|findings/ },
    { key:'ros', label:'Review of Systems', fieldRe:/review of systems|\bros\b/ },
    { key:'progress', label:'Note', fieldRe:/note|progress|narrative|free.?text|encounter|impression|document|hpi|assess|plan/ }
  ]; })();
  var BAD = /search|find|lookup|filter|chat|messag|comment|reason for|\baddress\b|e-?mail|phone|\bnpi\b|\bmrn\b|patient.?id|claim|login|password|user.?name|\bzip\b|\bcity\b|\bstate\b/;
  function route(t) { t = String(t || '').toLowerCase(); var order = ['procedure','insurance','orders','diagnoses','assessment_plan','hpi','physical_exam','ros']; var SIG = {
      procedure:['preoperative diagnos','postoperative diagnos','description of procedure','date of operation','indications for procedure','estimated blood loss','operative note','op note','fluorosc','epidural steroid','medial branch','radiofrequency','under anesthesia','informed consent was obtained','type of anesthesia'],
      insurance:['insurance:','primary insurance','payer:','policy number','member id','group number','subscriber','copay','deductible','medicare','medicaid','aetna','cigna','umr'],
      orders:['cpt:','cpt code','hcpcs','procedure code','billing code','e/m level','orders:'],
      diagnoses:['icd-10','icd10','diagnosis:','diagnoses:','problem list','dx:'],
      assessment_plan:['assessment:','impression:','plan:','differential','follow up in','follow-up in','recommend'],
      hpi:['chief complaint','history of present illness','hpi:','presents with','complains of','interval history'],
      physical_exam:['physical exam','on exam','palpation','range of motion','tenderness','reflexes','straight leg raise'],
      ros:['review of systems','ros:','denies fever','constitutional:'] };
    var bestK = 'progress', bestN = 0; order.forEach(function (k) { var n = 0; (SIG[k]||[]).forEach(function (s) { if (t.indexOf(s) >= 0) n++; }); if (n > bestN) { bestN = n; bestK = k; } });
    if (bestN < 2) bestK = 'progress'; return bestK; }
  function fieldSection(h) { for (var i = 0; i < DEFS.length; i++) { if (DEFS[i].fieldRe.test(h)) return DEFS[i].key; } return 'other'; }
  var target = forcedSection || route(noteText);
  var tdef = null; for (var d = 0; d < DEFS.length; d++) { if (DEFS[d].key === target) { tdef = DEFS[d]; break; } } if (!tdef) tdef = DEFS[DEFS.length - 1];
  function score(el) { var r = el.getBoundingClientRect(); var area = Math.min(r.width * r.height, 400000); var h = hay(el); var s = area / 1000;
    if (tdef.fieldRe.test(h)) s += 2000;
    if (/note|hpi|assess|plan|soap|progress|narrative|subjective|objective|impression|free.?text|document|history of present/.test(h)) s += 400;
    if (BAD.test(h)) s -= 1800;
    if ((el.tagName || '') === 'TEXTAREA') s += 120;
    if (el.isContentEditable) s += 100;
    try { if (el === document.activeElement) s += 9000; } catch (e) {}
    return s; }
  var cs = [].slice.call(document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"],input[type="text"],input:not([type])')).filter(vis);
  try { var act = document.activeElement; if (act && (act.tagName === 'TEXTAREA' || act.isContentEditable || act.tagName === 'INPUT') && cs.indexOf(act) < 0) { var ar = act.getBoundingClientRect(); if (ar.width > 40 && ar.height > 12) cs.push(act); } } catch (e) {}
  var ranked = cs.map(function (el) { var h = hay(el); return { el: el, sc: score(el), sec: fieldSection(h), label: (ownLabel(el) || sectionHeading(el) || (el.tagName || '').toLowerCase()) }; }).sort(function (a, b) { return b.sc - a.sc; });
  var best = ranked[0] || null;
  var cands = [], seen = {}; ranked.forEach(function (o) { var key = (o.label || '').toLowerCase(); if (o.label && !seen[key] && cands.length < 6) { seen[key] = 1; cands.push({ label: o.label, section: o.sec }); } });
  return { has: !!best, score: best ? best.sc : -1e12, count: cs.length, target: target, targetLabel: tdef.label, chosenSection: best ? best.sec : 'other', chosenLabel: best ? best.label : '', targetMatched: best ? tdef.fieldRe.test(hay(best.el)) : false, candidates: cands };
}

// ---- Field paster (injected): find best field for the target section, write+confirm ----
// v1.28 — self-contained for injection: the caller passes the precomputed `scan` (from
// mlsFieldScanner run across frames) so this function does NOT depend on out-of-scope
// helpers, and it routes the write through a NESTED copy of the hardened mlsRobustType.
// Async (executeScript awaits the result).
async function mlsNotePaster(text, forcedSection, scan) {
  if (!scan) { try { scan = mlsFieldScanner(text, forcedSection); } catch (e) { scan = { has: false }; } }
  if (!scan || !scan.has) return { ok: false, notfound: true, target: scan && scan.target, targetLabel: scan && scan.targetLabel, candidates: scan && scan.candidates };
  function vis(el) { try { if (el.disabled || el.readOnly) return false; var s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < .05) return false; var r = el.getBoundingClientRect(); return r.width > 110 && r.height > 18; } catch (e) { return false; } }
  function ownLabel(el) { try { var l = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'))) || ''; if (!l && el.id) { var lb = document.querySelector('label[for="' + el.id + '"]'); if (lb) l = (lb.textContent || '').trim(); } return String(l).replace(/\s+/g, ' ').trim().slice(0, 48); } catch (e) { return ''; } }
  function sectionHeading(el) { try { var n = el, hops = 0; while (n && hops < 5) { n = n.parentElement; hops++; if (!n) break; var hd = n.querySelector && n.querySelector('h1,h2,h3,h4,h5,h6,legend,[role="heading"]'); if (hd) { var ht = (hd.textContent || '').trim(); if (ht && ht.length <= 64) return ht.replace(/\s+/g, ' '); } } } catch (e) {} return ''; }
  async function _robustType(el, txt) {
    txt = String(txt == null ? '' : txt);
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    function _isEd(e) { if (!e || !e.tagName) return false; if (e.isContentEditable) return true; var tg = e.tagName.toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') { var t = (e.getAttribute('type') || 'text').toLowerCase(); return /^(text|search|email|url|tel|number|password|date|month|week|time|datetime-local|)$/.test(t); } return false; }
    function _resolve(e) { if (_isEd(e)) return e; if (!e || !e.tagName) return e; try { if (e.tagName.toUpperCase() === 'LABEL') { var f = e.getAttribute('for'); if (f) { var byId = document.getElementById(f); if (_isEd(byId)) return byId; } var within = e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(within)) return within; } } catch (e2) {} try { var n = e.querySelector && e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(n)) return n; } catch (e3) {} try { var p = e.parentElement, d = 0; while (p && d < 3) { var inp = p.querySelector && p.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(inp)) return inp; p = p.parentElement; d++; } } catch (e5) {} return e; }
    el = _resolve(el);
    if (!el || !_isEd(el)) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'no-field', into: 0 };
    if (el.readOnly || el.disabled) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'readonly', into: 0 };
    var CE = !!el.isContentEditable;
    function rd() { return CE ? (el.innerText || el.textContent || '') : (el.value || ''); }
    function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function digits(s) { return String(s || '').replace(/\D/g, ''); }
    function isMasked() { try { if (CE) return false; var t = (el.getAttribute('type') || '').toLowerCase(); if (t === 'date' || t === 'tel') return true; var ph = el.getAttribute('placeholder') || ''; if (/[\/\-.]/.test(ph) && /[mdyhMDYH#0_]/.test(ph)) return true; if (el.getAttribute('inputmode') === 'numeric') return true; if (el.getAttribute('data-mask') || el.getAttribute('pattern')) return true; var ml = el.maxLength; if (ml && ml > 0 && ml <= 12 && /[\/\-.]/.test(ph)) return true; } catch (e) {} return false; }
    var masked = isMasked();
    function landed() { var cur = rd(); if (!cur && txt) return false; var a = norm(cur), b = norm(txt); if (!b) return true; if (a.indexOf(b.slice(0, Math.min(b.length, 40))) >= 0) return true; if (masked) { var dc = digits(cur), dt = digits(txt); if (dt && dc.indexOf(dt) >= 0) return true; } return cur.replace(/\s+/g, '').length >= Math.min(txt.replace(/\s+/g, '').length, 15); }
    function setNative(v) { if (CE) { try { el.textContent = v; } catch (e) {} return; } var pr = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }
    function fireInput(data, type) { try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {} } }
    function clearField() { try { if (!CE && el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {} setNative(''); fireInput('', 'deleteContentBackward'); }
    function _vis(e) { try { var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e2) { return true; } }
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { el.click(); } catch (e) {}
    try { el.focus(); } catch (e) {}
    await sleep(0);
    async function keystroke() { clearField(); for (var i = 0; i < txt.length; i++) { var ch = txt.charAt(i); try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true })); } catch (e) {} if (CE) { var ok; try { ok = document.execCommand('insertText', false, ch); } catch (e) { ok = false; } if (!ok) setNative(rd() + ch); } else { var base = (el.value != null) ? el.value : ''; setNative(base + ch); } fireInput(ch, 'insertText'); try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } catch (e) {} await sleep(masked ? 18 : 6); } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
    async function pickSuggestion() { await sleep(320); var opts = []; var ac = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')); if (ac) { var box = document.getElementById(ac); if (box) opts = [].slice.call(box.querySelectorAll('[role=option],li,.option,.item')).filter(_vis); } if (!opts.length) opts = [].slice.call(document.querySelectorAll('[role=option],[role=listbox] li,.autocomplete-item,.suggestion,.typeahead-option,ul[class*=auto] li,ul[class*=suggest] li,li[class*=option]')).filter(_vis); if (!opts.length) { var lists = [].slice.call(document.querySelectorAll('ul,ol,[role=listbox],[role=menu]')).filter(_vis); for (var L = 0; L < lists.length && !opts.length; L++) { var items = [].slice.call(lists[L].querySelectorAll('li,[role=option],[role=menuitem]')).filter(_vis); if (items.length && items.length <= 25) opts = items; } } if (!opts.length) return { picked: false }; var want = norm(txt), pick = null; for (var i = 0; i < opts.length; i++) { if (norm(opts[i].textContent).indexOf(want) >= 0) { pick = opts[i]; break; } } if (!pick) pick = opts[0]; if (!pick) return { picked: false }; try { pick.scrollIntoView({ block: 'center' }); } catch (e) {} var r = pick.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {} }); try { pick.click(); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {} await sleep(150); return { picked: true }; }
    var method = '';
    if (!masked) {
      try { try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {} if (CE) { try { var rg = document.createRange(); rg.selectNodeContents(el); var se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt })); } catch (e) {} var _ec; try { _ec = document.execCommand('insertText', false, txt); } catch (e) { _ec = false; } if (!_ec) setNative(txt); } else { clearField(); setNative(txt); } fireInput(txt, 'insertText'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {} } catch (e) {}
      await sleep(0); if (landed()) method = 'native';
      if (!method) { try { var dt = new DataTransfer(); dt.setData('text/plain', txt); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); fireInput(txt, 'insertFromPaste'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } catch (e) {} await sleep(0); if (landed()) method = 'paste'; }
    }
    if (!method && txt.length <= 4000) { try { await keystroke(); } catch (e) {} if (landed()) method = masked ? 'mask' : 'keystroke'; }
    var sug = { picked: false }; try { sug = await pickSuggestion(); } catch (e) {}
    if (sug.picked) { await sleep(60); method = method || (landed() ? 'typeahead' : 'typeahead-selected'); }
    await sleep(120);
    if (!landed()) { try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} await sleep(80); }
    if (landed()) return { ok: true, confirmed: true, stuck: false, method: method || 'native', into: rd().length };
    if (sug.picked) return { ok: true, confirmed: false, stuck: false, method: 'typeahead-selected', into: rd().length };
    return { ok: false, confirmed: false, stuck: true, method: 'unconfirmed', into: rd().length, reason: masked ? 'masked-rejected' : 'not-stuck' };
  }
  var probeLabel = scan.chosenLabel;
  var cs = [].slice.call(document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"],input[type="text"],input:not([type])')).filter(vis);
  try { var act = document.activeElement; if (act && (act.tagName === 'TEXTAREA' || act.isContentEditable || act.tagName === 'INPUT') && cs.indexOf(act) < 0) cs.push(act); } catch (e) {}
  var best = null; for (var i = 0; i < cs.length; i++) { var lab = (ownLabel(cs[i]) || sectionHeading(cs[i]) || (cs[i].tagName || '').toLowerCase()); if (lab === probeLabel) { best = cs[i]; break; } }
  if (!best) { try { if (document.activeElement && vis(document.activeElement)) best = document.activeElement; } catch (e) {} }
  if (!best) best = cs[0] || null;
  if (!best) return { ok: false, notfound: true, target: scan.target, targetLabel: scan.targetLabel, candidates: scan.candidates };
  var wr = await _robustType(best, text);
  try { best.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
  return { ok: !!wr.ok, confirmed: !!wr.confirmed, stuck: !!wr.stuck, method: wr.method, into: scan.chosenLabel || (best.tagName || '').toLowerCase(), len: wr.into, target: scan.target, targetLabel: scan.targetLabel, chosenSection: scan.chosenSection, chosenLabel: scan.chosenLabel, targetMatched: scan.targetMatched, candidates: scan.candidates };
}

// ---- Patient identity reader: open Athena chart (injected, runs per frame) ----
function mlsReadChartIdentity() {
  var txt = (document.body && document.body.innerText || '').replace(/ /g, ' ');
  var lo = txt.toLowerCase();
  function near(reLabel) { var m = reLabel.exec(txt); return m ? m : null; }
  var dob = '';
  var dm = /(?:dob|d\.o\.b\.|date of birth|birth date)\s*[:\-]?\s*([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{2,4})/i.exec(txt);
  if (dm) dob = dm[1];
  var mrn = '';
  var mm = /(?:mrn|medical record(?:\s*(?:no|number|#))?|chart\s*#|patient\s*id)\s*[:\-#]?\s*([a-z]?\d[a-z0-9\-]{2,})/i.exec(txt);
  if (mm) mrn = mm[1];
  var name = '';
  var nm = /(?:patient(?:\s*name)?|name)\s*[:\-]\s*([A-Z][A-Za-z'\-]+,\s*[A-Z][A-Za-z'\-]+(?:\s+[A-Z])?)/.exec(txt);
  if (nm) name = nm[1];
  if (!name) { var nm2 = /\b([A-Z][a-z'\-]+,\s+[A-Z][a-z'\-]+)\b/.exec(txt); if (nm2) name = nm2[1]; }
  var score = (dob ? 2 : 0) + (mrn ? 2 : 0) + (name ? 1 : 0);
  // clinical-ness so we pick the chart frame, not a nav frame
  ['problem','medication','allerg','vital','diagnos','assessment','encounter'].forEach(function (k) { if (lo.indexOf(k) >= 0) score += 0.2; });
  return { name: name, dob: dob, mrn: mrn, score: score };
}

// ---- Patient identity reader: MLS active patient (injected, runs on mlsscribe.com tab) ----
function mlsReadActivePatient() {
  function pick(o, keys) { for (var i = 0; i < keys.length; i++) { if (o && o[keys[i]] != null && String(o[keys[i]]).trim()) return String(o[keys[i]]).trim(); } return ''; }
  var p = null;
  try { if (window.activePatient && typeof window.activePatient === 'object') p = window.activePatient; } catch (e) {}
  try { if (!p && typeof window.getActivePtId === 'function' && typeof window.getPatients === 'function') { var id = window.getActivePtId(); var list = window.getPatients() || []; p = list.filter(function (x) { return x && (x.id === id || x.client_id === id || x.external_id === id); })[0] || null; } } catch (e) {}
  var name = '', dob = '', mrn = '';
  if (p) { name = pick(p, ['name','fullName','patientName']); if (!name) { var fn = pick(p, ['firstName','first','givenName']); var ln = pick(p, ['lastName','last','familyName']); if (ln || fn) name = (ln ? ln + ', ' : '') + fn; } dob = pick(p, ['dob','dateOfBirth','birthDate','DOB']); mrn = pick(p, ['mrn','MRN','medicalRecordNumber','chartId']); }
  if (!name || !dob) {
    // fall back to the visible unified patient card / patient bar
    try { var bar = document.querySelector('#mlsPatientCard, #patientBar, [data-mls-patient-card]') || document.body; var bt = (bar.innerText || ''); if (!dob) { var dm = /([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{2,4})/.exec(bt); if (dm) dob = dm[1]; } if (!mrn) { var mm = /(?:mrn|a-?\d|chart)\s*[:#\-]?\s*([a-z]?\d[a-z0-9\-]{2,})/i.exec(bt); if (mm) mrn = mm[1]; } if (!name) { var nm = /\b([A-Z][a-z'\-]+,?\s+[A-Z][a-z'\-]+)\b/.exec(bt); if (nm) name = nm[1]; } } catch (e) {}
  }
  return { name: name, dob: dob, mrn: mrn };
}

// ---- Patient matcher (pure/worker-scope, testable). Conservative: default refuse. ----
function mlsMatchPatients(mls, ath) {
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; }).sort(); }
  function normDob(s) { var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y; return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y; }
  function normMrn(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var mDob = normDob(mls && mls.dob), aDob = normDob(ath && ath.dob);
  var mMrn = normMrn(mls && mls.mrn), aMrn = normMrn(ath && ath.mrn);
  var mName = normName(mls && mls.name), aName = normName(ath && ath.name);
  var dobBoth = mDob && aDob, mrnBoth = mMrn && aMrn, nameBoth = mName.length && aName.length;
  var dobMatch = dobBoth && mDob === aDob;
  var mrnMatch = mrnBoth && mMrn === aMrn;
  function nameOverlap() { if (!nameBoth) return 0; var setA = {}; aName.forEach(function (w) { setA[w] = 1; }); var hit = 0; mName.forEach(function (w) { if (setA[w]) hit++; }); return hit; }
  var nameHits = nameOverlap();
  var nameMatch = nameBoth && nameHits >= 2;
  var nameContradict = nameBoth && nameHits === 0;
  // contradiction on any strong identifier => mismatch
  if ((dobBoth && !dobMatch) || (mrnBoth && !mrnMatch) || nameContradict) return { status: 'mismatch', dobMatch: dobMatch, mrnMatch: mrnMatch, nameMatch: nameMatch };
  // confident match needs a strong identifier (DOB or MRN), or a full name + one weak signal
  if (dobMatch || mrnMatch || (nameMatch && (mDob || mMrn ? false : true) && nameHits >= 2 && (mName.length >= 2))) {
    if (dobMatch || mrnMatch) return { status: 'match', dobMatch: dobMatch, mrnMatch: mrnMatch, nameMatch: nameMatch };
  }
  return { status: 'uncertain', dobMatch: dobMatch, mrnMatch: mrnMatch, nameMatch: nameMatch };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mlsRobustType: mlsRobustType, mlsFieldScanner: mlsFieldScanner, mlsNotePaster: mlsNotePaster, mlsRouteSection: mlsRouteSection, mlsSegmentNote: mlsSegmentNote, mlsMatchPatients: mlsMatchPatients, mlsReadChartIdentity: mlsReadChartIdentity, mlsReadActivePatient: mlsReadActivePatient };
}

function getCfg() { return new Promise(r => chrome.storage.local.get(['mlsBackend', 'mlsKey'], r)); }

// NO-API-KEY MODE: read the doctor's LIVE MLS login token straight out of an open,
// signed-in mlsscribe.com tab (same Bearer JWT the web app uses). This means the
// extension "just works" once they're logged into MLS — nothing to generate/paste.
// Cached briefly so we don't re-scan every single agent step.
let _sessTok = '', _sessAt = 0;
async function getSessionToken() {
  if (_sessTok && (Date.now() - _sessAt) < 60000) return _sessTok;
  try {
    const tabs = await chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] });
    // Prefer the most-recently-used MLS tab.
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    for (const tab of tabs) {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { try { return sessionStorage.getItem('sf_bk_token') || localStorage.getItem('sf_bk_token') || ''; } catch (e) { return ''; } }
        });
        const tok = (r && r.result || '').trim();
        if (tok) { _sessTok = tok; _sessAt = Date.now(); return tok; }
      } catch (e) { /* tab not scriptable (still loading / restricted) — try next */ }
    }
  } catch (e) {}
  return '';
}

async function callBackend(path, body) {
  const c = await getCfg();
  const base = (c.mlsBackend || DEFAULT_BACKEND).replace(/\/+$/, '');
  let key = (c.mlsKey || '').trim();
  let viaSession = false;
  if (!key) { key = await getSessionToken(); viaSession = true; }
  if (!key) return { error: 'Not connected. Open MLS (mlsscribe.com) in a tab and sign in — MLS Assist will use your login automatically. (Or add an API key via the toolbar icon.)' };
  try {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok) {
      // A stale session token? Drop the cache and tell them to re-sign-in.
      if (viaSession && r.status === 401) { _sessTok = ''; _sessAt = 0; return { error: 'Your MLS login expired — open mlsscribe.com and sign in again, then retry.' }; }
      return { error: d.error || ('Request failed (HTTP ' + r.status + ')') };
    }
    return d;
  } catch (e) { return { error: 'Network error: ' + e.message }; }
}
// Find the signed-in EMR/Athena tab broadly (known Athena domains, else EMR-ish host keywords,
// else the most-recently-active non-MLS http(s) tab). Shared by the Mode C search handlers; the
// real resilience is content-based scoring inside the injected driver, not the tab URL.
function mlsPickEmrTab(all) {
  return all.find((t) => /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(t.url || ''))
      || all.find((t) => /athena|epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|report|claim|billing|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com/i.test(t.url || ''))
      || (function () { const c = all.filter((t) => /^https?:/i.test(t.url || '') && !/mlsscribe\.com|chrome:\/\//i.test(t.url || '')); c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); return c[0]; })();
}

/*MLS_ATHENA_DRIVE_START*/
async function mlsAthenaDrive(op, params, cfg) {
  params = params || {}; cfg = cfg || {};
  var D = (typeof document !== 'undefined') ? document : null;
  if (!D) return { ok: false, error: 'no-document' };
  function arr(x) { return Array.isArray(x) ? x : []; }
  function lc(x) { return String(x == null ? '' : x).toLowerCase(); }
  var C = {
    cptFieldLabels:   arr(cfg.cptFieldLabels).length   ? cfg.cptFieldLabels   : ['cpt', 'procedure code', 'proc code', 'service code', 'hcpcs', 'code'],
    procFieldLabels:  arr(cfg.procFieldLabels).length  ? cfg.procFieldLabels  : ['procedure', 'service', 'description', 'exam', 'visit type'],
    dateFromLabels:   arr(cfg.dateFromLabels).length   ? cfg.dateFromLabels   : ['service date from', 'date of service from', 'dos from', 'date from', 'start date', 'from date', 'from', 'start', 'begin'],
    dateToLabels:     arr(cfg.dateToLabels).length     ? cfg.dateToLabels     : ['service date to', 'date of service to', 'dos to', 'date to', 'end date', 'to date', 'through', 'thru', 'to', 'end'],
    runLabels:        arr(cfg.runLabels).length        ? cfg.runLabels        : ['run report', 'run', 'search', 'view report', 'generate', 'go', 'apply', 'find', 'filter', 'submit', 'update'],
    nextLabels:       arr(cfg.nextLabels).length       ? cfg.nextLabels       : ['next page', 'next', '›', '»', '>', 'older', 'show more', 'load more', 'more results'],
    nextSelectors:    arr(cfg.nextSelectors).length    ? cfg.nextSelectors    : ['a[rel="next"]', '[aria-label*="next" i]', '.pagination .next a', 'li.next a', 'button[title*="next" i]', '[data-page="next"]', '.paging-next', '.next-page'],
    rowSelectors:     arr(cfg.rowSelectors).length     ? cfg.rowSelectors     : ['table tbody tr', '[role="row"]', '.result-row', '.report-row', '.GridRow', '.athena-row', 'tr'],
    excludeClickLabels: arr(cfg.excludeClickLabels).length ? cfg.excludeClickLabels : ['save', 'sign', 'finalize', 'close encounter', 'post', 'delete', 'remove', 'discard', 'bill', 'submit claim', 'approve', 'void', 'cancel appointment'],
    maxRowChars: cfg.maxRowChars || 44000
  };

  function vis(el) {
    try {
      if (!el) return false;
      var win = (el.ownerDocument && el.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
      var s = (win && win.getComputedStyle) ? win.getComputedStyle(el) : null;
      if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
      if (el.hidden) return false;
      if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
      return true;
    } catch (e) { return true; }
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function labelText(el) {
    var parts = [];
    try { ['aria-label', 'placeholder', 'title', 'name', 'id'].forEach(function (k) { var v = el.getAttribute && el.getAttribute(k); if (v) parts.push(v); }); } catch (e) {}
    try { if (el.id) { var lb = D.querySelector('label[for="' + cssEsc(el.id) + '"]'); if (lb && lb.textContent) parts.push(lb.textContent); } } catch (e) {}
    try { var wrap = el.closest && el.closest('label'); if (wrap && wrap.textContent) parts.push(wrap.textContent); } catch (e) {}
    try { var prev = el.previousElementSibling, hop = 0; while (prev && hop < 2) { var pt = (prev.textContent || '').trim(); if (pt && pt.length < 40) parts.push(pt); prev = prev.previousElementSibling; hop++; } } catch (e) {}
    return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function hasAny(hay, labels) { for (var i = 0; i < labels.length; i++) { var l = lc(labels[i]); if (l && hay.indexOf(l) >= 0) return true; } return false; }
  function editableInputs() {
    var nodes = [].slice.call(D.querySelectorAll('input,textarea,[contenteditable=""],[contenteditable="true"]'));
    return nodes.filter(function (el) {
      var tg = (el.tagName || '').toUpperCase();
      if (tg === 'INPUT') { var t = lc(el.getAttribute('type') || 'text'); if (['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color'].indexOf(t) >= 0) return false; }
      return vis(el);
    });
  }
  function findField(labels) {
    var ins = editableInputs(), best = null, bestS = -1;
    ins.forEach(function (el) {
      var hay = labelText(el), s = 0;
      labels.forEach(function (l, idx) { l = lc(l); if (l && hay.indexOf(l) >= 0) { s += 10 + (labels.length - idx); if (hay === l || hay.indexOf(l) === 0) s += 3; } });
      if (s > bestS) { bestS = s; best = el; }
    });
    return bestS > 0 ? best : null;
  }
  function findDateField(labels) {
    var ins = editableInputs(), best = null, bestS = -1;
    ins.forEach(function (el) {
      var hay = labelText(el), s = 0;
      labels.forEach(function (l) { l = lc(l); if (l && hay.indexOf(l) >= 0) s += 10; });
      var t = lc(el.getAttribute && el.getAttribute('type'));
      if (t === 'date') s += 4;
      if (/date|dob|dos/.test(hay)) s += 2;
      if (s > bestS) { bestS = s; best = el; }
    });
    return bestS > 0 ? best : null;
  }
  function clickables() { return [].slice.call(D.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')).filter(vis); }
  function btnText(el) { var t = (el.textContent || '') + ' ' + (el.value || '') + ' ' + labelText(el); return t.replace(/\s+/g, ' ').trim().toLowerCase(); }
  function findButton(labels) {
    var bs = clickables(), best = null, bestS = -1;
    bs.forEach(function (el) {
      var t = btnText(el); if (hasAny(t, C.excludeClickLabels)) return;
      var s = 0; labels.forEach(function (l, idx) { l = lc(l); if (!l) return; if (t === l) s += 20; else if (t.indexOf(l) >= 0) s += 10 + (labels.length - idx); });
      if (s > bestS) { bestS = s; best = el; }
    });
    return bestS > 0 ? best : null;
  }
  function isDisabled(el) {
    try {
      if (el.disabled) return true;
      if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
      if (/\bdisabled\b/.test((el.className || '') + '')) return true;
      if (el.closest && el.closest('.disabled,[aria-disabled="true"]')) return true;
    } catch (e) {}
    return false;
  }
  function findNext() {
    for (var i = 0; i < C.nextSelectors.length; i++) {
      try { var el = D.querySelector(C.nextSelectors[i]); if (el && vis(el) && !isDisabled(el)) { var t = btnText(el); if (!hasAny(t, C.excludeClickLabels)) return el; } } catch (e) {}
    }
    var bs = clickables(), best = null;
    for (var j = 0; j < bs.length; j++) {
      var e = bs[j]; if (isDisabled(e)) continue; var tt = btnText(e); if (hasAny(tt, C.excludeClickLabels)) continue;
      for (var k = 0; k < C.nextLabels.length; k++) { var l = lc(C.nextLabels[k]); if (!l) continue; if (tt === l) return e; if (tt.length <= 14 && tt.indexOf(l) >= 0) { best = best || e; } }
    }
    return best;
  }
  function extractRows() {
    var bestText = '', bestCount = 0, used = '';
    for (var i = 0; i < C.rowSelectors.length; i++) {
      try {
        var rows = [].slice.call(D.querySelectorAll(C.rowSelectors[i])).filter(vis);
        if (rows.length >= 2) {
          var txt = rows.map(function (r) { return ((r.innerText || r.textContent || '') + '').replace(/\s+/g, ' ').trim(); }).filter(function (s) { return s.length > 2; }).join('\n');
          if (rows.length > bestCount && txt) { bestCount = rows.length; bestText = txt; used = C.rowSelectors[i]; }
        }
      } catch (e) {}
    }
    if (!bestText) { try { bestText = (((D.body && (D.body.innerText || D.body.textContent)) || '') + '').slice(0, C.maxRowChars); } catch (e) {} }
    return { text: bestText.slice(0, C.maxRowChars), count: bestCount, selector: used };
  }
  function sigOf(s) { s = String(s || ''); var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return ((h >>> 0).toString(36)) + ':' + s.length; }
  function scoreReportSelf() {
    try {
      var t = (((D.body && (D.body.innerText || D.body.textContent)) || '') + ''), tl = t.toLowerCase(), s = 0;
      var dates = (t.match(/\b[01]?\d[\/\-][0-3]?\d[\/\-]\d{2,4}\b/g) || []).length; s += Math.min(dates, 200) * 2;
      var cpts = (t.match(/\b\d{5}\b/g) || []).length; s += Math.min(cpts, 200) * 1.5;
      ['cpt', 'procedure', 'service date', 'dos', 'claim', 'charge', 'mrn', 'dob', 'patient'].forEach(function (k) { if (tl.indexOf(k) >= 0) s += 5; });
      return Math.round(s);
    } catch (e) { return 0; }
  }
  function fireClick(el) {
    try { el.scrollIntoView && el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var V = (el.ownerDocument && el.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) {
      try { var Ctor = (V && (tp.indexOf('pointer') === 0 ? V.PointerEvent : V.MouseEvent)) || (V && V.Event); el.dispatchEvent(new Ctor(tp, { bubbles: true, cancelable: true })); }
      catch (e) { try { el.dispatchEvent(new Event(tp, { bubbles: true })); } catch (e2) {} }
    });
    try { el.click && el.click(); } catch (e) {}
  }
  function fmtDate(el, ymd) {
    var t = lc(el.getAttribute && el.getAttribute('type'));
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return ymd;
    if (t === 'date') return ymd; return m[2] + '/' + m[3] + '/' + m[1];
  }
  async function typeInto(el, val) {
    val = String(val == null ? '' : val);
    try { el.focus && el.focus(); } catch (e) {}
    var tg = (el.tagName || '').toUpperCase(), CE = el.isContentEditable;
    var V = (el.ownerDocument && el.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
    function setNative(v) {
      if (CE) { try { el.textContent = v; } catch (e) {} return; }
      try { var proto = tg === 'TEXTAREA' ? V.HTMLTextAreaElement.prototype : V.HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(proto, 'value'); if (d && d.set) { d.set.call(el, v); return; } } catch (e) {}
      try { el.value = v; } catch (e) {}
    }
    function fire(type, ctor, init) { try { el.dispatchEvent(new V[ctor](type, init || { bubbles: true })); } catch (e) { try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e2) {} } }
    setNative(''); fire('input', 'InputEvent', { bubbles: true, inputType: 'deleteContentBackward' });
    setNative(val);
    fire('keydown', 'KeyboardEvent', { bubbles: true });
    fire('input', 'InputEvent', { bubbles: true, inputType: 'insertText', data: val });
    fire('keyup', 'KeyboardEvent', { bubbles: true });
    fire('change', 'Event', { bubbles: true });
    var got = CE ? (el.textContent || '') : (el.value || '');
    var want = val.replace(/\s+/g, '');
    return (got.replace(/\s+/g, '').indexOf(want.slice(0, Math.min(want.length, 8))) >= 0) || got.length > 0;
  }

  if (op === 'read') {
    var ex = extractRows(), nx = findNext();
    return { ok: true, op: 'read', text: ex.text, count: ex.count, selector: ex.selector, sig: sigOf(ex.text), hasNext: !!nx, nextDesc: nx ? btnText(nx).slice(0, 40) : '', score: scoreReportSelf() };
  }
  if (op === 'next') {
    var n2 = findNext(); if (!n2) return { ok: true, op: 'next', clicked: false };
    var desc = btnText(n2).slice(0, 40); fireClick(n2);
    return { ok: true, op: 'next', clicked: true, nextDesc: desc };
  }
  if (op === 'fill') {
    var res = { ok: true, op: 'fill', acted: false, controls: {} };
    var cpt = (params.cpt && params.cpt[0]) || '', proc = params.procedureName || '';
    var f = null;
    if (cpt) { f = findField(C.cptFieldLabels); if (f) { res.controls.cpt = labelText(f).slice(0, 40) || '(cpt)'; if (await typeInto(f, cpt)) { res.filledCpt = true; res.acted = true; } } }
    if (proc) { var pf = findField(C.procFieldLabels); if (pf && pf !== f) { res.controls.proc = labelText(pf).slice(0, 40) || '(proc)'; if (await typeInto(pf, proc)) { res.filledProc = true; res.acted = true; } } }
    var df = findDateField(C.dateFromLabels), dt = findDateField(C.dateToLabels);
    if (df && dt && df === dt) {
      var ds = editableInputs().filter(function (el) { var t = lc(el.getAttribute && el.getAttribute('type')); var h = labelText(el); return t === 'date' || /date|dos|from|to|through|thru/.test(h); });
      if (ds.length >= 2) { df = ds[0]; dt = ds[1]; }
    }
    if (params.dateFrom && df) { res.controls.from = labelText(df).slice(0, 40); if (await typeInto(df, fmtDate(df, params.dateFrom))) { res.filledFrom = true; res.acted = true; } }
    if (params.dateTo && dt) { res.controls.to = labelText(dt).slice(0, 40); if (await typeInto(dt, fmtDate(dt, params.dateTo))) { res.filledTo = true; res.acted = true; } }
    var rb = findButton(C.runLabels);
    if (rb) { res.controls.run = btnText(rb).slice(0, 40); fireClick(rb); res.clickedRun = true; res.acted = true; } else { res.noRunButton = true; }
    return res;
  }
  return { ok: false, error: 'bad-op' };
}
/*MLS_ATHENA_DRIVE_END*/

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  // Tell the popup how we're authenticating: a saved API key, the live MLS login, or nothing yet.
  if (msg.type === 'mlsConnStatus') {
    (async () => {
      const c = await getCfg();
      if ((c.mlsKey || '').trim()) return sendResponse({ mode: 'key' });
      const tok = await getSessionToken();
      sendResponse({ mode: tok ? 'session' : 'none' });
    })();
    return true;
  }
  if (msg.type === 'mlsAssistGenerate') { callBackend('/api/assist/note', { transcript: msg.transcript }).then(sendResponse); return true; }
  if (msg.type === 'mlsAssistAgentStep') { callBackend('/api/assist/agent-step', { goal: msg.goal, pageText: msg.pageText, screenshot: msg.screenshot, history: msg.history }).then(sendResponse); return true; }
  if (msg.type === 'mlsAssistExtract') { callBackend('/api/assist/extract', { pageText: msg.pageText, url: msg.url }).then(sendResponse); return true; }
  // Pull the day's SCHEDULE from the EMR tab (Athena) → return its page text so MLS can
  // parse the appointments and pre-load today's patients. Reads every frame (Athena is iframe-based).
  if (msg.type === 'mlsAppScheduleRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        // Find the EMR tab by KNOWN domains, else by EMR-looking host keywords, else the
        // most-recently-active non-MLS http(s) tab. Kept broad so an Athena domain/URL change
        // doesn't break us — the real work is content-based below.
        let tab = all.find((t) => /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(t.url || ''))
               || all.find((t) => /athena|epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com/i.test(t.url || ''));
        if (!tab) {
          const cand = all.filter((t) => /^https?:/i.test(t.url || '') && !/mlsscribe\.com|chrome:\/\//i.test(t.url || ''));
          cand.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
          tab = cand[0];
        }
        if (!tab) return sendResponse({ ok: false, error: 'Open your EMR schedule (e.g. the Athena day view) in another tab, then try again.' });
        // Read every frame WITH its URL so we can isolate the SCHEDULE/CALENDAR frame and
        // drop the noise (athenaText messaging, department lists) that would pollute parsing.
        let results = [];
        try {
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => { try { return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 22000) }; } catch (e) { return { u: '', t: '' }; } }
          });
        } catch (e) {
          results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 22000) }) });
        }
        const frames = results.map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
        // CONTENT-SCORE each frame for "looks like a schedule" — appointment times, day/date
        // labels, scheduling words. This is what makes us resilient to Athena changing their
        // frame names / URLs: we find the schedule by what's IN it, not where it lives.
        const scoreSched = (f) => {
          const u = (f.u || '').toLowerCase(), t = (f.t || ''), tl = t.toLowerCase();
          let s = 0;
          if (/schedul|calendar|appointment|booking|frontoffice|dashboard/.test(u)) s += 25;     // URL hint = bonus, not required
          s += Math.min((t.match(/\b\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?/gi) || []).length, 60) * 2; // clock times = strongest signal
          ['appointment', 'schedul', 'provider', 'booking', 'arrived', 'checked in', 'check-in', 'exam room', 'no show', 'walk-in'].forEach((k) => { if (tl.indexOf(k) >= 0) s += 6; });
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].forEach((d) => { if (tl.indexOf(d) >= 0) s += 2; });
          s -= /conversation|colleague|inbox|message/.test(tl) ? 20 : 0;                            // de-rank the messaging frame
          s += Math.min(t.length, 14000) / 500;                                                     // size as a minor tiebreaker
          return s;
        };
        let pick = null, best = -1;
        frames.forEach((f) => { const s = scoreSched(f); if (s > best) { best = s; pick = f; } });
        pick = pick || { u: tab.url, t: '' };
        // Include the page title so the parser can anchor the date range of a multi-day view.
        sendResponse({ ok: true, text: ((tab.title ? ('[' + tab.title + ']\n') : '') + (pick.t || '')).slice(0, 22000), url: pick.u || tab.url, title: tab.title, frames: frames.length });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // READ-ONLY: read the open Athena REPORT / claims / procedure / patient LIST tab so MLS can
  // enumerate patients by procedure/CPT (Study cohort, Mode B). Resilient by design: it finds
  // the EMR tab broadly, reads EVERY frame, and CONTENT-SCORES each for "looks like a report
  // table" (many dated rows, CPT-like 5-digit codes, $ charges, claim/procedure/service-date
  // headers). It returns the richest table frame PLUS a capped concatenation of the top frames
  // (a report can span frames), so the app's parser sees the whole list. It never writes.
  if (msg.type === 'mlsAppReportRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        // Same broad EMR-tab finder as the schedule path: known Athena domains, else EMR-ish
        // host keywords, else the most-recently-active non-MLS http(s) tab.
        let tab = all.find((t) => /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(t.url || ''))
               || all.find((t) => /athena|epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|report|claim|billing|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com/i.test(t.url || ''));
        if (!tab) {
          const cand = all.filter((t) => /^https?:/i.test(t.url || '') && !/mlsscribe\.com|chrome:\/\//i.test(t.url || ''));
          cand.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
          tab = cand[0];
        }
        if (!tab) return sendResponse({ ok: false, error: 'Open your Athena report (e.g. a procedure/CPT claims report or a filtered schedule) in another tab, then try again.' });
        let results = [];
        try {
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => { try { return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 60000) }; } catch (e) { return { u: '', t: '' }; } }
          });
        } catch (e) {
          results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 60000) }) });
        }
        const frames = results.map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
        // CONTENT-SCORE each frame for "looks like a report/claims/procedure LIST" — what makes
        // us resilient to Athena renaming frames/URLs: we find the report by what's IN it.
        const scoreReport = (f) => {
          const u = (f.u || '').toLowerCase(), t = (f.t || ''), tl = t.toLowerCase();
          let s = 0;
          if (/report|claim|billing|procedure|encounter|export|analy|registr|worklist|patient.?list/.test(u)) s += 20; // URL hint = bonus, not required
          const dates = (t.match(/\b[01]?\d[\/\-][0-3]?\d[\/\-]\d{2,4}\b/g) || []).length;          // dated rows (DOB / service date)
          s += Math.min(dates, 200) * 2;
          const cpts = (t.match(/\b\d{5}\b/g) || []).length;                                         // CPT-like 5-digit codes
          s += Math.min(cpts, 200) * 1.5;
          const money = (t.match(/\$\s?\d/g) || []).length;                                          // charges
          s += Math.min(money, 100);
          ['cpt', 'procedure', 'service date', 'date of service', 'dos', 'claim', 'charge', 'billed', 'units', 'modifier', 'rendering', 'diagnosis', 'icd', 'mrn', 'date of birth', 'dob', 'patient name'].forEach((k) => { if (tl.indexOf(k) >= 0) s += 5; });
          s -= /conversation|colleague|inbox|message|chat/.test(tl) ? 25 : 0;                         // de-rank the messaging frame
          s += Math.min(t.length, 40000) / 600;                                                       // size as a minor tiebreaker
          return s;
        };
        const scored = frames.map((f) => ({ f: f, s: scoreReport(f) })).sort((a, b) => b.s - a.s);
        const best = scored[0] || { f: { u: tab.url, t: '' }, s: 0 };
        // A report can render across sibling frames; concat the top few scoring frames (capped)
        // so the app parser sees every patient row, not just the single best frame.
        let concat = '';
        for (const sc of scored) { if (sc.s <= 0) break; if (concat.length > 44000) break; concat += (concat ? '\n\n' : '') + (sc.f.t || ''); }
        const text = ((tab.title ? ('[' + tab.title + ']\n') : '') + (concat || best.f.t || '')).slice(0, 46000);
        sendResponse({ ok: true, text: text, url: best.f.u || tab.url, title: tab.title, frames: frames.length, bestScore: Math.round(best.s) });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // ===== Mode C: DRIVE the athenaOne procedure search + paginate (READ-ONLY) =====
  // The injected mlsAthenaDrive runs in EVERY frame; we pick the frame that actually has the
  // controls / the report, so it is resilient to Athena's frames. It only operates the search
  // controls (CPT/procedure + dates + Run/Next) and NEVER clicks Save/Sign (excludeClickLabels).
  // FILL + RUN the search.
  if (msg.type === 'mlsAppSearchFill') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = mlsPickEmrTab(all);
        if (!tab) return sendResponse({ ok: false, error: 'Open your signed-in athenaOne in another tab (a procedure/claims report or charge-search screen), then try again.' });
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaDrive, args: ['fill', msg.params || {}, msg.cfg || {}] }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: mlsAthenaDrive, args: ['fill', msg.params || {}, msg.cfg || {}] }); }
        const vals = results.map((r) => r && r.result).filter(Boolean);
        let acted = null;
        vals.forEach((v) => { if (v && v.acted) { if (!acted || (v.clickedRun && !acted.clickedRun)) acted = v; } });
        sendResponse({ ok: true, tabId: tab.id, acted: acted || { acted: false }, frames: vals.length });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // READ the current result page (best-scoring frame) + detect a Next control.
  if (msg.type === 'mlsAppSearchRead') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = (msg.tabId && all.find((t) => t.id === msg.tabId)) || mlsPickEmrTab(all);
        if (!tab) return sendResponse({ ok: false, error: 'No athenaOne tab found.' });
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaDrive, args: ['read', {}, msg.cfg || {}] }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: mlsAthenaDrive, args: ['read', {}, msg.cfg || {}] }); }
        const vals = results.map((r) => r && r.result).filter((v) => v && v.ok).sort((a, b) => (b.score || 0) - (a.score || 0));
        const best = vals[0] || { text: '', sig: '', hasNext: false, count: 0, score: 0, nextDesc: '' };
        let concat = '';
        for (const v of vals) { if ((v.score || 0) <= 0) break; if (concat.length > 44000) break; if (v.text) concat += (concat ? '\n\n' : '') + v.text; }
        sendResponse({ ok: true, tabId: tab.id, text: (concat || best.text || '').slice(0, 46000), sig: best.sig, hasNext: vals.some((v) => v.hasNext), nextDesc: best.nextDesc || '', rowCount: best.count || 0, bestScore: best.score || 0, frames: vals.length });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // CLICK the Next-page control in the best report frame.
  if (msg.type === 'mlsAppSearchNext') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = (msg.tabId && all.find((t) => t.id === msg.tabId)) || mlsPickEmrTab(all);
        if (!tab) return sendResponse({ ok: false, error: 'No athenaOne tab found.' });
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaDrive, args: ['next', {}, msg.cfg || {}] }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: mlsAthenaDrive, args: ['next', {}, msg.cfg || {}] }); }
        const clicked = results.map((r) => r && r.result).filter(Boolean).some((v) => v.clicked);
        sendResponse({ ok: true, tabId: tab.id, clicked: clicked });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }

  // Open + read ONE PATIENT'S CHART from Athena. If a patient name is given, try to

  // click that patient (in the schedule/search) to open their chart, then read the
  // frame that scores highest on clinical-chart keywords (so we never grab the schedule).
  if (msg.type === 'mlsAppChartRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        let tab = all.find((t) => /athenahealth|athenanet|athena\.io|\.px\.athena/i.test(t.url || ''));
        if (!tab) { const cand = all.filter((t) => /^https?:/i.test(t.url || '') && !/mlsscribe\.com|chrome:\/\//i.test(t.url || '')); cand.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); tab = cand[0]; }
        if (!tab) return sendResponse({ ok: false, error: 'Open the patient in your Athena tab, then try again.' });
        const want = String(msg.patient || '').trim();
        let opened = false;
        // Click a visible patient name, OR type the name into an Athena search box, so we
        // can OPEN the chart without the doctor having to click it themselves.
        const openFn = (name) => {
          try {
            const parts = name.toLowerCase().replace(/[^a-z\s,]/g, '').split(/[\s,]+/).filter(Boolean);
            if (!parts.length) return 'no';
            const last = parts[parts.length - 1], first = parts[0];
            const clickName = () => {
              const els = Array.from(document.querySelectorAll('a,button,[role="link"],[role="button"],[onclick],td,li,span,div'));
              for (const el of els) {
                const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                if (t && t.length < 70 && t.indexOf(last) >= 0 && (parts.length < 2 || t.indexOf(first) >= 0)) {
                  const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { el.click(); return true; }
                }
              }
              return false;
            };
            if (clickName()) return 'clicked';
            const inputs = Array.from(document.querySelectorAll('input[type="text"],input[type="search"],input:not([type])'));
            const box = inputs.find((i) => {
              const h = ((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.id || '')).toLowerCase();
              const r = i.getBoundingClientRect(); const t = (i.type || '').toLowerCase();
              if (r.width <= 0 || r.height <= 0) return false;
              // NEVER type a patient NAME into a numeric / ID field — that's what throws Athena's
              // "Patient ID must be numeric" error. Skip number/tel/date fields and any ID-ish label.
              if (t === 'number' || t === 'tel' || t === 'date' || t === 'email' || t === 'password') return false;
              if ((i.inputMode || '').toLowerCase() === 'numeric') return false;
              if (/patient\s*id|patientid|\bid\b|\bmrn\b|chart\s*(id|no|num)|\bnpi\b|account|claim|invoice|\bnumber\b|ssn|\bdob\b/.test(h)) return false;
              return /search|name|find|look\s*up|lookup|filter|patient/.test(h);
            });
            if (box) {
              box.focus(); box.value = name;
              box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true }));
              ['keydown', 'keypress', 'keyup'].forEach((tp) => box.dispatchEvent(new KeyboardEvent(tp, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
              return 'searched';
            }
            return 'no';
          } catch (e) { return 'no'; }
        };
        if (want) {
          let statuses = [];
          try { const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: openFn, args: [want] }); statuses = res.map((r) => r && r.result); } catch (e) {}
          if (statuses.indexOf('clicked') >= 0) { opened = true; await new Promise((r) => setTimeout(r, 1900)); }
          else if (statuses.indexOf('searched') >= 0) {
            // gave Athena the name — wait for results, then click the matching result.
            await new Promise((r) => setTimeout(r, 2600));
            try { const res2 = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: openFn, args: [want] }); if (res2.map((r) => r && r.result).indexOf('clicked') >= 0) { opened = true; await new Promise((r) => setTimeout(r, 1900)); } } catch (e) {}
          }
        }
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => { try { return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 14000) }; } catch (e) { return { u: '', t: '' }; } } }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 14000) }) }); }
        const frames = results.map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
        const score = (txt) => { const s = (txt || '').toLowerCase(); let n = 0; ['problem', 'medication', 'allerg', 'history', 'vital', 'diagnos', 'assessment', 'date of birth', 'dob', 'surg', 'imaging', 'mri', 'immuniz'].forEach((k) => { if (s.indexOf(k) >= 0) n++; }); return n; };
        let pick = null, best = -1;
        frames.forEach((f) => { const sc = score(f.t) * 1000 + Math.min(f.t.length, 13000) / 100; if (sc > best) { best = sc; pick = f; } });
        pick = pick || { u: tab.url, t: '' };
        sendResponse({ ok: true, text: (pick.t || '').slice(0, 16000), url: pick.u || tab.url, title: tab.title, opened: opened, frames: frames.length });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // Read the innerText of whatever tab is ACTIVE right now (so the agent sees the
  // tab it is currently on, even after a tab switch).
  if (msg.type === 'mlsAssistPageText') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ text: '' });
        // Read EVERY frame (top + iframes) so the agent can see iframe-based EMRs.
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => (document.body && document.body.innerText || '').slice(0, 6000) }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (document.body && document.body.innerText || '').slice(0, 9000) }); }
        let text = '';
        for (const fr of results) { const t = fr && fr.result; if (t) { text += (text ? '\n---- (frame) ----\n' : '') + t; } if (text.length > 12000) break; }
        sendResponse({ text: text.slice(0, 12000), url: tab.url, title: tab.title });
      } catch (e) { sendResponse({ text: '' }); }
    })();
    return true;
  }
  // Numbered inventory of the interactive controls on the ACTIVE tab. The agent
  // targets these by #index, which is far more reliable than guessing labels.
  // MUST stay in lock-step with _inv() inside mlsAssistExec (same selector/order).
  if (msg.type === 'mlsAssistElements') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ list: [] });
        const perFrame = () => {
          function vis(el) { try { if (el.disabled) return false; if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false; var st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false; var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; return true; } catch (e) { return true; } }
          function lab(e) { var s = (e.innerText || e.value || (e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('name'))) || e.id || ''); return String(s).replace(/\s+/g, ' ').trim().slice(0, 60); }
          var sel = 'button,a[href],[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable="true"],[onclick]';
          var nodes = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).slice(0, 120);
          return nodes.map(function (e) { var tag = (e.tagName || '').toLowerCase(); var ty = e.getAttribute && e.getAttribute('type'); var role = e.getAttribute && e.getAttribute('role'); var ph = e.getAttribute && e.getAttribute('placeholder'); return tag + (ty ? ('[' + ty + ']') : '') + (role ? (' role=' + role) : '') + ' «' + (lab(e) || ph || '') + '»'; });
        };
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: perFrame }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: perFrame }); }
        const list = [], map = [];
        for (const fr of results) {
          const arr = (fr && fr.result) || [];
          for (let li = 0; li < arr.length; li++) {
            if (list.length >= 120) break;
            map.push({ frameId: fr.frameId || 0, localIndex: li });
            list.push(list.length + ': ' + arr[li]);
          }
          if (list.length >= 120) break;
        }
        _mlsFrameMap[tab.id] = map;
        sendResponse({ list });
      } catch (e) { sendResponse({ list: [] }); }
    })();
    return true;
  }
  // Execute a single agent action on the ACTIVE tab (or switch tabs). This lets the
  // autopilot act on whatever tab it is on, including after switching.
  if (msg.type === 'mlsAssistExec') {
    (async () => {
      try {
        const action = msg.action || {};
        if (action.type === 'switchtab') {
          const tabs = await chrome.tabs.query({});
          const t = String(action.target || '').toLowerCase().trim();
          const http = tabs.filter(x => /^https?:/.test(x.url || ''));
          let tab = t ? http.find(x => ((x.title || '').toLowerCase().includes(t) || (x.url || '').toLowerCase().includes(t))) : null;
          if (!tab) { const others = http.filter(x => !x.active).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); tab = others[0]; }
          if (!tab) return sendResponse({ ok: false, msg: 'No other tab to switch to.' });
          await chrome.tabs.update(tab.id, { active: true });
          try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
          return sendResponse({ ok: true, msg: 'Switched to: ' + (tab.title || tab.url || 'tab') });
        }
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ ok: false, msg: 'No active tab.' });
        // Frame routing: a "#index" target may live inside an iframe (Athena, etc.).
        // Look it up in the map built by mlsAssistElements and run the action in THAT
        // frame, passing the element's local index so it resolves the exact control.
        let _execTarget = { tabId: tab.id };
        let _act = action;
        const _im = /^#(\d+)$/.exec(String(action.target || '').trim());
        if (_im && _mlsFrameMap[tab.id] && _mlsFrameMap[tab.id][+_im[1]]) {
          const _ent = _mlsFrameMap[tab.id][+_im[1]];
          if (_ent.frameId) _execTarget = { tabId: tab.id, frameIds: [_ent.frameId] };
          _act = Object.assign({}, action, { _localIdx: _ent.localIndex });
        }
        // Retry wrapper: web EMRs render asynchronously, so a target may not exist on
        // the first try. We re-run the injected executor a few times with a short
        // settle delay — but ONLY when the failure was "couldn't find it" (notfound).
        // Success returns immediately, so the happy path stays fast.
        const tries = (action && /^(click|confirm|type|select|pastenote)$/.test(action.type || '')) ? 5 : 1;
        let r = null;
        for (let i = 0; i < tries; i++) {
          [r] = await chrome.scripting.executeScript({
          target: _execTarget,
          args: [_act],
          func: async (act) => {
            function visible(el) {
              if (!el) return false;
              try {
                if (el.disabled) return false;
                if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
                const st = getComputedStyle(el);
                if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false;
                const rc = el.getBoundingClientRect();
                if (rc.width < 1 || rc.height < 1) return false;
                return true;
              } catch (e) { return true; }
            }
            function labelOf(e) {
              return ((e.innerText || e.value || (e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('name') || e.id)) || '') + '').toLowerCase().replace(/\s+/g, ' ').trim();
            }
            // Rebuild the SAME ordered inventory the agent saw, so a "#index" target
            // maps to the exact element. Must match mlsAssistElements above.
            function _inv() {
              function vis(el) { try { if (el.disabled) return false; if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false; var st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false; var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; return true; } catch (e) { return true; } }
              var sel = 'button,a[href],[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable="true"],[onclick]';
              return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).slice(0, 120);
            }
            function _byIdx(t) { var m = /^#(\d+)$/.exec(String(t || '').trim()); if (!m) return null; var el = _inv()[+m[1]]; return (el && visible(el)) ? el : (el || null); }
            // When frame-routed, the background passes the element's LOCAL index in this frame.
            function _local() { try { return (typeof act._localIdx === 'number') ? (_inv()[act._localIdx] || null) : null; } catch (e) { return null; } }
            // Scored finder — prefers an exact label, a visible & enabled element, an
            // interactive role, and one inside the viewport. Far more accurate than the
            // old "first substring match", which often clicked the wrong control.
            function findEl(target) {
              if (!target) return null;
              try { const el = document.querySelector(target); if (el && visible(el)) return el; } catch (e) {}
              const t = String(target).toLowerCase().replace(/\s+/g, ' ').trim();
              if (!t) return null;
              const cand = [...document.querySelectorAll('button,a,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input,textarea,select,label,[onclick],[contenteditable=""],[contenteditable="true"]')];
              const tc = t.replace(/[^a-z0-9 ]/g, '').trim();
              let best = null, bestScore = 19;
              for (const e of cand) {
                const lab = labelOf(e);
                if (!lab) continue;
                let s = -1;
                if (lab === t) s = 100;
                else if (lab.replace(/[^a-z0-9 ]/g, '').trim() === tc) s = 90;
                else if (lab.startsWith(t) || lab.endsWith(t)) s = 70;
                else if (lab.includes(t)) s = 50 - Math.min(40, Math.abs(lab.length - t.length));
                if (s < 0) continue;
                if (visible(e)) s += 30; else s -= 25;
                const tag = (e.tagName || '').toLowerCase();
                if (tag === 'button' || (e.getAttribute && e.getAttribute('role') === 'button') || tag === 'a') s += 6;
                try { const rc = e.getBoundingClientRect(); if (rc.top >= 0 && rc.top < innerHeight) s += 4; } catch (er) {}
                if (s > bestScore) { bestScore = s; best = e; }
              }
              return best;
            }
            function fireClick(el) {
              try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
              const r = el.getBoundingClientRect();
              const x = r.left + r.width / 2, y = r.top + r.height / 2;
              const opt = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
              for (const t of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                try { el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, opt)); } catch (e) {}
              }
              try { el.click(); } catch (e) {}
            }
            // v1.28 — hardened, VERIFIED text entry (same logic as top-level mlsRobustType):
            // resolves a real editable field from a label/wrapper, clicks+focuses, native
            // setter -> simulated paste -> per-character keystrokes that drive MASKED inputs,
            // then SELECTS a matching TYPEAHEAD suggestion, and re-reads after settle + blur.
            // Returns {ok, confirmed, stuck, picked, method, reason} so the loop can stop.
            async function typeInto(el, text) {
              var txt = String(text == null ? '' : text);
              var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
              function _isEd(e) { if (!e || !e.tagName) return false; if (e.isContentEditable) return true; var tg = e.tagName.toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') { var t = (e.getAttribute('type') || 'text').toLowerCase(); return /^(text|search|email|url|tel|number|password|date|month|week|time|datetime-local|)$/.test(t); } return false; }
              function _resolve(e) { if (_isEd(e)) return e; if (!e || !e.tagName) return e; try { if (e.tagName.toUpperCase() === 'LABEL') { var f = e.getAttribute('for'); if (f) { var byId = document.getElementById(f); if (_isEd(byId)) return byId; } var within = e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(within)) return within; } } catch (e2) {} try { var n = e.querySelector && e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(n)) return n; } catch (e3) {} try { var sib = e.nextElementSibling, k = 0; while (sib && k < 3) { if (_isEd(sib)) return sib; var inS = sib.querySelector && sib.querySelector('input:not([type=hidden]),textarea,[contenteditable]'); if (_isEd(inS)) return inS; sib = sib.nextElementSibling; k++; } } catch (e4) {} try { var p = e.parentElement, d = 0; while (p && d < 3) { var inp = p.querySelector && p.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(inp)) return inp; p = p.parentElement; d++; } } catch (e5) {} return e; }
              el = _resolve(el);
              if (!el || !_isEd(el)) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'no-field', into: 0 };
              if (el.readOnly || el.disabled) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'readonly', into: 0 };
              var CE = !!el.isContentEditable;
              function rd() { return CE ? (el.innerText || el.textContent || '') : (el.value || ''); }
              function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
              function digits(s) { return String(s || '').replace(/\D/g, ''); }
              function isMasked() { try { if (CE) return false; var t = (el.getAttribute('type') || '').toLowerCase(); if (t === 'date' || t === 'tel') return true; var ph = el.getAttribute('placeholder') || ''; if (/[\/\-.]/.test(ph) && /[mdyhMDYH#0_]/.test(ph)) return true; if (el.getAttribute('inputmode') === 'numeric') return true; if (el.getAttribute('data-mask') || el.getAttribute('pattern')) return true; var ml = el.maxLength; if (ml && ml > 0 && ml <= 12 && /[\/\-.]/.test(ph)) return true; } catch (e) {} return false; }
              var masked = isMasked();
              function landed() { var cur = rd(); if (!cur && txt) return false; var a = norm(cur), b = norm(txt); if (!b) return true; if (a.indexOf(b.slice(0, Math.min(b.length, 40))) >= 0) return true; if (masked) { var dc = digits(cur), dt = digits(txt); if (dt && dc.indexOf(dt) >= 0) return true; } return cur.replace(/\s+/g, '').length >= Math.min(txt.replace(/\s+/g, '').length, 15); }
              function setNative(v) { if (CE) { try { el.textContent = v; } catch (e) {} return; } var pr = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }
              function fireInput(data, type) { try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {} } }
              function clearField() { try { if (!CE && el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {} setNative(''); fireInput('', 'deleteContentBackward'); }
              function _vis(e) { try { var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e2) { return true; } }
              try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
              try { el.click(); } catch (e) {}
              try { el.focus(); } catch (e) {}
              await sleep(0);
              async function keystroke() { clearField(); for (var i = 0; i < txt.length; i++) { var ch = txt.charAt(i); try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true })); } catch (e) {} if (CE) { var ok; try { ok = document.execCommand('insertText', false, ch); } catch (e) { ok = false; } if (!ok) setNative(rd() + ch); } else { var base = (el.value != null) ? el.value : ''; setNative(base + ch); } fireInput(ch, 'insertText'); try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } catch (e) {} await sleep(masked ? 18 : 6); } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
              async function pickSuggestion() { await sleep(320); var opts = []; var ac = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')); if (ac) { var box = document.getElementById(ac); if (box) opts = [].slice.call(box.querySelectorAll('[role=option],li,.option,.item')).filter(_vis); } if (!opts.length) opts = [].slice.call(document.querySelectorAll('[role=option],[role=listbox] li,.autocomplete-item,.suggestion,.typeahead-option,ul[class*=auto] li,ul[class*=suggest] li,li[class*=option]')).filter(_vis); if (!opts.length) { var lists = [].slice.call(document.querySelectorAll('ul,ol,[role=listbox],[role=menu]')).filter(_vis); for (var L = 0; L < lists.length && !opts.length; L++) { var items = [].slice.call(lists[L].querySelectorAll('li,[role=option],[role=menuitem]')).filter(_vis); if (items.length && items.length <= 25) opts = items; } } if (!opts.length) return { picked: false }; var want = norm(txt), pick = null; for (var i = 0; i < opts.length; i++) { if (norm(opts[i].textContent).indexOf(want) >= 0) { pick = opts[i]; break; } } if (!pick) pick = opts[0]; if (!pick) return { picked: false }; try { pick.scrollIntoView({ block: 'center' }); } catch (e) {} var r = pick.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {} }); try { pick.click(); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {} await sleep(150); return { picked: true, label: (pick.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) }; }
              var method = '';
              if (!masked) {
                try { try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {} if (CE) { try { var rg = document.createRange(); rg.selectNodeContents(el); var se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt })); } catch (e) {} var _ec; try { _ec = document.execCommand('insertText', false, txt); } catch (e) { _ec = false; } if (!_ec) setNative(txt); } else { clearField(); setNative(txt); } fireInput(txt, 'insertText'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {} } catch (e) {}
                await sleep(0); if (landed()) method = 'native';
                if (!method) { try { var dt = new DataTransfer(); dt.setData('text/plain', txt); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); fireInput(txt, 'insertFromPaste'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } catch (e) {} await sleep(0); if (landed()) method = 'paste'; }
              }
              if (!method && txt.length <= 4000) { try { await keystroke(); } catch (e) {} if (landed()) method = masked ? 'mask' : 'keystroke'; }
              var sug = { picked: false }; try { sug = await pickSuggestion(); } catch (e) {}
              if (sug.picked) { await sleep(60); method = method || (landed() ? 'typeahead' : 'typeahead-selected'); }
              await sleep(120);
              if (!landed()) { try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} await sleep(80); }
              if (landed()) return { ok: true, confirmed: true, stuck: false, method: method || 'native', into: rd().length, picked: !!sug.picked, pickedLabel: sug.label || '' };
              if (sug.picked) return { ok: true, confirmed: false, stuck: false, method: 'typeahead-selected', into: rd().length, picked: true, pickedLabel: sug.label || '', reason: 'selected-suggestion-unconfirmed' };
              return { ok: false, confirmed: false, stuck: true, method: 'unconfirmed', into: rd().length, reason: masked ? 'masked-rejected' : 'not-stuck' };
            }
            function setSelectByText(sel, text) {
              const t = String(text || '').toLowerCase().trim();
              let opt = [...sel.options].find(o => (o.textContent || '').toLowerCase().trim() === t || (o.value || '').toLowerCase().trim() === t);
              if (!opt) opt = [...sel.options].find(o => ((o.textContent || '').toLowerCase().trim().includes(t)) || ((o.value || '').toLowerCase().trim() === t));
              if (!opt) return false;
              sel.value = opt.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
            }
            const a = act || {};
            if (a.type === 'select') {
              const t = String(a.target || '').toLowerCase().trim();
              let sel = null;
              var _bi = _local() || _byIdx(a.target); if (_bi && _bi.tagName === 'SELECT') sel = _bi;
              try { if (!sel) { const q = document.querySelector(a.target); if (q && q.tagName === 'SELECT') sel = q; } } catch (e) {}
              if (!sel) sel = [...document.querySelectorAll('select')].find(s => (((s.id || '') + ' ' + (s.name || '') + ' ' + (s.getAttribute('aria-label') || '') + ' ' + (s.getAttribute('title') || '')).toLowerCase().includes(t)));
              if (!sel) sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => (o.textContent || '').toLowerCase().includes(String(a.text || '').toLowerCase().trim())));
              if (!sel) return { ok: false, notfound: true, msg: 'No dropdown found for: ' + (a.target || '') };
              return setSelectByText(sel, a.text) ? { ok: true, msg: 'Set ' + (a.target || 'dropdown') + ' to ' + (a.text || '') } : { ok: false, msg: 'Option not found: ' + (a.text || '') };
            }
            if (a.type === 'click' || a.type === 'confirm') {
              const el = _local() || _byIdx(a.target) || findEl(a.target);
              if (!el) {
                const t = String(a.target || '').toLowerCase().trim();
                for (const s of document.querySelectorAll('select')) { const o = [...s.options].find(o => (o.textContent || '').toLowerCase().trim().includes(t)); if (o) { s.value = o.value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, msg: 'Selected option: ' + (a.target || '') }; } }
                return { ok: false, notfound: true, msg: 'Could not find: ' + (a.target || '') };
              }
              fireClick(el); return { ok: true, msg: 'Clicked: ' + (a.target || '') };
            }
            if (a.type === 'type') {
              // findEl may return a <label>/wrapper for a label-style target like
              // "Name / label *"; typeInto._resolve() climbs to the real <input>.
              const el = _local() || _byIdx(a.target) || findEl(a.target) || (visible(document.activeElement) ? document.activeElement : null);
              if (!el) return { ok: false, notfound: true, msg: 'No field to type into.' };
              if (el.tagName === 'SELECT') return setSelectByText(el, a.text) ? { ok: true, confirmed: true, msg: 'Selected ' + (a.text || '') + ' in ' + (a.target || 'dropdown') } : { ok: false, msg: 'Option not found in dropdown.' };
              var _tr = await typeInto(el, a.text || '');
              if (_tr && _tr.confirmed) return { ok: true, confirmed: true, msg: 'Typed "' + String(a.text || '').slice(0, 40) + '" into ' + (a.target || 'field') + ' — verified (' + _tr.method + ').' };
              if (_tr && _tr.picked) return { ok: true, confirmed: false, picked: true, msg: 'Selected "' + (_tr.pickedLabel || a.text || '') + '" from the suggestion list for ' + (a.target || 'field') + ' — please confirm it shows in the field.' };
              return { ok: false, stuck: true, reason: (_tr && _tr.reason) || 'not-stuck', msg: 'Tried to type into ' + (a.target || 'the field') + ' every way (clicked it, native set, simulated paste, key-by-key, and looked for a suggestion list)' + ((_tr && _tr.reason === 'readonly') ? ', but it is read-only/disabled' : (_tr && _tr.reason === 'no-field') ? ', but it is not an editable field' : '') + ' and the text did not stick. Please click the field and type ' + (a.text ? '"' + String(a.text).slice(0, 40) + '"' : 'the value') + ' yourself.' };
            }
            if (a.type === 'pastenote') {
              function isEd(el2) { if (!el2) return false; var tg = (el2.tagName || '').toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') return /^(text|search|email|url|tel|)$/i.test(el2.type || ''); return !!el2.isContentEditable; }
              var cs = [...document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')].filter(function (el2) { if (!visible(el2)) return false; var rr = el2.getBoundingClientRect(); return rr.width > 120 && rr.height > 36; });
              cs.sort(function (x, y) { var rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect(); return (ry.width * ry.height) - (rx.width * rx.height); });
              var pe = cs[0] || (isEd(document.activeElement) ? document.activeElement : null);
              if (!pe) return { ok: false, notfound: true, msg: 'No note field found to paste into.' };
              pe.scrollIntoView({ block: 'center' }); var _pr = await typeInto(pe, a.text || '');
              if (_pr && _pr.confirmed) return { ok: true, confirmed: true, msg: 'Pasted the note into the chart field (' + ((a.text || '').length) + ' chars) — verified.' };
              return { ok: false, stuck: true, msg: 'Tried to paste the note every way but could not confirm it landed — click the note field in the EMR, or use the panel Insert/Copy.' };
            }
            if (a.type === 'scroll') { window.scrollBy(0, a.dir === 'up' ? -600 : 600); return { ok: true, msg: 'Scrolled.' }; }
            if (a.type === 'read') { return { ok: true, msg: 'Read the screen.' }; }
            return { ok: false, msg: 'Unknown action.' };
          }
          });
          const res = (r && r.result) || {};
          if (res.ok || !res.notfound || i === tries - 1) break; // stop on success, hard error, or last try
          await new Promise(res2 => setTimeout(res2, 350)); // settle, then retry
        }
        sendResponse((r && r.result) || { ok: false, msg: 'No result.' });
      } catch (e) { sendResponse({ ok: false, msg: 'Action failed: ' + e.message }); }
    })();
    return true;
  }
  // Paste the drafted note into the note field of the CURRENT tab, searching EVERY
  // frame (top + iframes) so iframe-based EMRs like athenaOne/Epic work. v1.26: picks
  // the best frame by note-field SCORE (identity + size), confirms the paste landed,
  // and retries once if it didn't. Returns {ok, confirmed, into}. Never clicks Save/Sign.
  if (msg.type === 'mlsPasteHere') {
    (async () => {
      try {
        const note = String(msg.note || '');
        if (!note.trim()) return sendResponse({ ok: false, error: 'empty' });
        let tabId = sender && sender.tab && sender.tab.id;
        if (!tabId) { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = t && t.id; }
        if (!tabId) return sendResponse({ ok: false });
        let last = { ok: false };
        for (let attempt = 0; attempt < 2; attempt++) {
          let measure = [];
          try { measure = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, args: [note], func: mlsFieldScanner }); }
          catch (e) { measure = await chrome.scripting.executeScript({ target: { tabId }, args: [note], func: mlsFieldScanner }); }
          let winnerFrame = null, bestScore = -1e12, winnerScan = null;
          (measure || []).forEach(function (m) { if (m && m.result && m.result.has && m.result.score > bestScore) { bestScore = m.result.score; winnerFrame = (m.frameId != null ? m.frameId : 0); winnerScan = m.result; } });
          if (winnerFrame === null) { last = { ok: false, notfound: true }; await new Promise(r => setTimeout(r, 450)); continue; }
          const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [winnerFrame] }, args: [note, null, winnerScan], func: mlsNotePaster });
          last = (r && r.result) || { ok: false };
          if (last.ok && last.confirmed) break;
          await new Promise(res2 => setTimeout(res2, 450));
        }
        if (last.ok) sendResponse({ ok: true, confirmed: !!last.confirmed, into: last.into, method: last.method, target: last.target, targetLabel: last.targetLabel, chosenSection: last.chosenSection, chosenLabel: last.chosenLabel, targetMatched: !!last.targetMatched, candidates: last.candidates });
        else sendResponse({ ok: false });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }
  // VERIFIED WRITE (v1.27) — the patient-safety gate + smart multi-field routing +
  // reliable typing, tied together. Flow: identify the open Athena chart's patient and
  // the MLS active patient, MATCH them, and ONLY write on a confident match (unless the
  // doctor explicitly overrides after seeing the mismatch). Then segment the note and
  // route each part to its matching Athena field (insurance->insurance, ICD-10->diagnoses,
  // CPT->orders, op-note->Procedure Documentation, ...), confirming each. Never Save/Sign.
  if (msg.type === 'mlsVerifiedWrite') {
    (async () => {
      try {
        const note = String(msg.note || '');
        const force = !!msg.force;
        if (!note.trim()) return sendResponse({ ok: false, error: 'Nothing to insert yet.' });
        const isMls = (u) => /mlsscribe\.com/.test(u || '');
        // 1) Find the EMR (Athena) tab — prefer the tab the panel is on, else newest non-MLS tab.
        let emrTab = null;
        const su = (sender && sender.tab && sender.tab.url) || '';
        if (sender && sender.tab && /^https?:/.test(su) && !isMls(su)) emrTab = sender.tab;
        if (!emrTab) { const tabs = await chrome.tabs.query({}); const c = tabs.filter(t => /^https?:/.test(t.url || '') && !isMls(t.url || '')); c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); emrTab = c[0]; }
        if (!emrTab) return sendResponse({ ok: false, error: 'No EMR/chart tab is open. Open the patient chart in your EMR, then try again.' });
        // 2) Read the open chart's patient identity (best-scoring frame).
        let chartId = { name: '', dob: '', mrn: '', score: 0 };
        try { const idr = await chrome.scripting.executeScript({ target: { tabId: emrTab.id, allFrames: true }, func: mlsReadChartIdentity }); (idr || []).forEach(m => { if (m && m.result && m.result.score > chartId.score) chartId = m.result; }); }
        catch (e) { try { const [ir] = await chrome.scripting.executeScript({ target: { tabId: emrTab.id }, func: mlsReadChartIdentity }); if (ir && ir.result) chartId = ir.result; } catch (e2) {} }
        // 3) Read the MLS active patient from a signed-in mlsscribe.com tab.
        let mlsPt = { name: '', dob: '', mrn: '' };
        try { const mt = await chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] }); mt.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); for (const t of mt) { try { const [mr] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: mlsReadActivePatient }); if (mr && mr.result && (mr.result.name || mr.result.dob || mr.result.mrn)) { mlsPt = mr.result; break; } } catch (e) {} } } catch (e) {}
        // 4) Match (conservative — default refuse). Names appear only in the doctor's own browser.
        const match = mlsMatchPatients(mlsPt, chartId);
        const patient = { mlsName: mlsPt.name || '', mlsDob: mlsPt.dob || '', mlsMrn: mlsPt.mrn || '', athName: chartId.name || '', athDob: chartId.dob || '', athMrn: chartId.mrn || '' };
        // 5) HARD GATE.
        if (match.status !== 'match' && !force) {
          return sendResponse({ ok: false, blocked: true, patientStatus: match.status, match: match, patient: patient,
            reason: match.status === 'mismatch' ? 'Patient mismatch — refusing to write into this chart.' : 'Could not confidently verify the patient — refusing to write.' });
        }
        // 6) Segment + route each piece to its matching field, confirming each.
        const segs = mlsSegmentNote(note);
        const wrote = [];
        for (const seg of segs) {
          let last = { ok: false };
          for (let attempt = 0; attempt < 2; attempt++) {
            let measure = [];
            try { measure = await chrome.scripting.executeScript({ target: { tabId: emrTab.id, allFrames: true }, args: [seg.text, seg.section], func: mlsFieldScanner }); }
            catch (e) { measure = await chrome.scripting.executeScript({ target: { tabId: emrTab.id }, args: [seg.text, seg.section], func: mlsFieldScanner }); }
            let wf = null, bs = -1e12, wfScan = null;
            (measure || []).forEach(m => { if (m && m.result && m.result.has && m.result.score > bs) { bs = m.result.score; wf = (m.frameId != null ? m.frameId : 0); wfScan = m.result; } });
            if (wf === null) { last = { ok: false, notfound: true, targetLabel: (measure[0] && measure[0].result && measure[0].result.targetLabel) || seg.section }; await new Promise(r => setTimeout(r, 400)); continue; }
            const [r] = await chrome.scripting.executeScript({ target: { tabId: emrTab.id, frameIds: [wf] }, args: [seg.text, seg.section, wfScan], func: mlsNotePaster });
            last = (r && r.result) || { ok: false };
            if (last.ok && last.confirmed) break;
            await new Promise(r => setTimeout(r, 400));
          }
          wrote.push({ section: seg.section, targetLabel: last.targetLabel || seg.section, chosenLabel: last.chosenLabel || '', confirmed: !!last.confirmed, written: !!last.ok, notfound: !!last.notfound, method: last.method || '' });
        }
        sendResponse({ ok: true, forced: force, patientStatus: match.status, match: match, patient: patient, wrote: wrote });
      } catch (e) { sendResponse({ ok: false, error: 'Verified write failed: ' + e.message }); }
    })();
    return true;
  }

  if (msg.type === 'mlsAppCaptureRequest') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const cands = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com/.test(t.url || ''));
        cands.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const tab = cands[0];
        if (!tab) return sendResponse({ error: 'No EMR tab is open. Open the patient in your EMR in another tab, then try again.' });
        let pageText = '';
        try {
          const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (document.body && document.body.innerText || '').slice(0, 20000) });
          pageText = (r && r.result) || '';
        } catch (e) { return sendResponse({ error: 'Could not read the EMR tab (' + e.message + ').' }); }
        if (!pageText.trim()) return sendResponse({ error: 'The EMR tab had no readable text.' });
        const res = await callBackend('/api/assist/extract', { pageText, url: tab.url });
        sendResponse(Object.assign({ fromTab: tab.url }, res));
      } catch (e) { sendResponse({ error: 'Capture failed: ' + e.message }); }
    })();
    return true;
  }
  // Send a finished MLS note INTO the EMR: find the patient's note field (across
  // frames, so Athena's iframes work), then paste. v1.26: scores frames by note-field
  // identity+size, confirms the text landed, and retries once. Never clicks Save/Sign.
  if (msg.type === 'mlsAppPasteRequest') {
    (async () => {
      try {
        const note = String(msg.note || '');
        if (!note.trim()) return sendResponse({ error: 'Nothing to send.' });
        const tabs = await chrome.tabs.query({});
        const cands = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com/.test(t.url || ''));
        cands.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const tab = cands[0];
        if (!tab) return sendResponse({ error: 'No EMR tab is open. Open the patient in your EMR in another tab, then try again.' });
        try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
        let last = { ok: false }, foundField = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          let measure = [];
          try { measure = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, args: [note], func: mlsFieldScanner }); }
          catch (e) { measure = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [note], func: mlsFieldScanner }); }
          let winnerFrame = null, bestScore = -1e12, winnerScan = null;
          (measure || []).forEach(function (m) { if (m && m.result && m.result.has && m.result.score > bestScore) { bestScore = m.result.score; winnerFrame = (m.frameId != null ? m.frameId : 0); winnerScan = m.result; } });
          if (winnerFrame === null) { await new Promise(r => setTimeout(r, 450)); continue; }
          foundField = true;
          const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [winnerFrame] }, args: [note, null, winnerScan], func: mlsNotePaster });
          last = (r && r.result) || { ok: false };
          if (last.ok && last.confirmed) break;
          await new Promise(res2 => setTimeout(res2, 450));
        }
        if (last.ok && last.confirmed) sendResponse({ ok: true, confirmed: true, into: last.into, method: last.method, target: last.target, targetLabel: last.targetLabel, chosenSection: last.chosenSection, chosenLabel: last.chosenLabel, targetMatched: !!last.targetMatched, candidates: last.candidates });
        else if (last.ok) sendResponse({ ok: true, confirmed: false, into: last.into, method: last.method, target: last.target, targetLabel: last.targetLabel, chosenSection: last.chosenSection, chosenLabel: last.chosenLabel, targetMatched: !!last.targetMatched, candidates: last.candidates, warn: 'Wrote to the field but could not confirm the text landed — please check the EMR before signing.' });
        else if (foundField) sendResponse({ error: 'Found a note field but could not paste. Click into the EMR note area, then try again.' });
        else sendResponse({ error: 'Could not find a note field on the EMR page. Open the patient and click into the note area, then try again.' });
      } catch (e) { sendResponse({ error: 'Send failed: ' + e.message }); }
    })();
    return true;
  }
  if (msg.type === 'mlsAssistCapture') {
    try { chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => sendResponse({ dataUrl: dataUrl || '' })); }
    catch (e) { sendResponse({ dataUrl: '' }); }
    return true;
  }
});


// Self-update notifier: badge the icon when a newer version is published.
async function mlsCheckBadge() {
  try {
    const cur = chrome.runtime.getManifest().version;
    const r = await fetch('https://mlsscribe.com/extension-version.json?t=' + Date.now());
    const d = await r.json();
    const cmp = (a, b) => { a = String(a).split('.').map(Number); b = String(b).split('.').map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x > y) return 1; if (x < y) return -1; } return 0; };
    if (d && d.version && cmp(d.version, cur) > 0) { chrome.action.setBadgeText({ text: '↑' }); chrome.action.setBadgeBackgroundColor({ color: '#1f7ae0' }); }
    else chrome.action.setBadgeText({ text: '' });
  } catch (e) {}
}
try { mlsCheckBadge(); } catch (e) {}
try { chrome.runtime.onStartup.addListener(mlsCheckBadge); } catch (e) {}
try { chrome.runtime.onInstalled.addListener(mlsCheckBadge); } catch (e) {}


// ===========================================================================
// NIGHTLY BACKUP (browser-side). At the chosen local time, the extension finds
// your logged-in EMR tab, captures the open chart, then walks the patient-list
// links it can see and captures each chart — sending them to MLS (encrypted).
// REQUIRES: this computer ON, Chrome running, and the EMR tab still SIGNED IN.
// Best-effort by design: web-UI scraping can miss patients an API sync wouldn't.
// ===========================================================================
const BK_KEY = 'mlsBackup';
function getBackup() { return new Promise(r => chrome.storage.local.get([BK_KEY], c => r(Object.assign({ enabled: false, hour: 2, minute: 0, maxPatients: 250 }, c[BK_KEY] || {})))); }
function setBackup(v) { return new Promise(r => chrome.storage.local.set({ [BK_KEY]: v }, () => r(v))); }

async function scheduleBackupAlarm() {
  try { await chrome.alarms.clear('mlsNightlyBackup'); } catch (e) {}
  const b = await getBackup();
  if (!b.enabled) return;
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), (b.hour | 0), (b.minute | 0), 0, 0);
  if (next.getTime() <= now.getTime() + 5000) next.setDate(next.getDate() + 1);
  try { chrome.alarms.create('mlsNightlyBackup', { when: next.getTime(), periodInMinutes: 1440 }); } catch (e) {}
}
try { chrome.alarms.onAlarm.addListener(a => { if (a && a.name === 'mlsNightlyBackup') runNightlyBackup('schedule'); }); } catch (e) {}
try { chrome.runtime.onStartup.addListener(scheduleBackupAlarm); } catch (e) {}
try { chrome.runtime.onInstalled.addListener(scheduleBackupAlarm); } catch (e) {}
scheduleBackupAlarm();

function findEmrTab(tabs) {
  const c = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com|\/\/github\.com|mail\.google\.com|console\.twilio|dashboard\.stripe/.test(t.url || ''));
  const ath = c.find(t => /athena/i.test((t.url || '') + ' ' + (t.title || '')));
  if (ath) return ath;
  c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return c[0] || null;
}
async function tabInnerText(tabId, max) {
  try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, args: [max || 20000], func: (m) => (document.body && document.body.innerText || '').slice(0, m) }); return (r && r.result) || ''; }
  catch (e) { return ''; }
}
function waitTabComplete(tabId, timeout) {
  return new Promise(res => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; try { chrome.tabs.onUpdated.removeListener(l); } catch (e) {} res(); } }, timeout || 15000);
    function l(id, info) { if (id === tabId && info.status === 'complete') { done = true; clearTimeout(to); try { chrome.tabs.onUpdated.removeListener(l); } catch (e) {} res(); } }
    chrome.tabs.onUpdated.addListener(l);
  });
}
async function collectRoster(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const out = [], seen = new Set();
      const re = /patient|chart|clinical|encounter|\bexam\b|chartid|enc=|patientid|deptid|pat_id/i;
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href || '', raw = a.getAttribute('href') || '', txt = (a.innerText || '').trim();
        if (!/^https?:/.test(href)) continue;
        if (!re.test(href) && !re.test(raw)) continue;
        if (seen.has(href)) continue; seen.add(href);
        out.push({ href, txt: txt.slice(0, 80) });
        if (out.length >= 400) break;
      }
      return out;
    }});
    return (r && r.result) || [];
  } catch (e) { return []; }
}
async function runNightlyBackup(trigger) {
  const started = Date.now();
  const cfg = await getBackup();
  const finish = async (res) => { await setBackup(Object.assign(await getBackup(), { lastRun: res.at, lastResult: res })); return res; };
  const tabs = await chrome.tabs.query({});
  const emr = findEmrTab(tabs);
  if (!emr) return finish({ ok: false, error: 'No EMR tab is open. Leave an Athena tab open and signed in.', at: new Date().toISOString() });
  const firstText = await tabInnerText(emr.id, 6000);
  if (firstText.length < 1500 && /\b(log\s?in|sign\s?in|password|username)\b/i.test(firstText)) {
    return finish({ ok: false, error: 'The EMR tab looks signed out — nothing was backed up. Stay signed in to Athena overnight.', at: new Date().toISOString() });
  }
  let captured = 0, patients = 0, errors = 0;
  // 1) capture the chart currently open
  if (firstText.trim()) {
    const c = await callBackend('/api/assist/extract', { pageText: firstText, url: emr.url });
    if (c && c.ok) { captured++; if (c.patient) patients++; } else if (c && c.error) { errors++; }
  }
  // 2) walk patient-list links and capture each
  const roster = await collectRoster(emr.id);
  const origUrl = emr.url;
  const cap = Math.min(roster.length, cfg.maxPatients || 250);
  for (let i = 0; i < cap; i++) {
    try {
      await chrome.tabs.update(emr.id, { url: roster[i].href });
      await waitTabComplete(emr.id, 15000);
      await new Promise(r => setTimeout(r, 1300));
      const txt = await tabInnerText(emr.id, 20000);
      if (!txt.trim()) continue;
      const c = await callBackend('/api/assist/extract', { pageText: txt, url: roster[i].href });
      if (c && c.ok) { captured++; if (c.patient) patients++; } else if (c && c.error) { errors++; }
    } catch (e) { errors++; }
    await new Promise(r => setTimeout(r, 400));
  }
  try { await chrome.tabs.update(emr.id, { url: origUrl }); } catch (e) {}
  return finish({ ok: true, captured, patients, errors, scanned: roster.length, trigger: trigger || 'manual', at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'mlsGetBackup') { getBackup().then(sendResponse); return true; }
  if (msg.type === 'mlsSetBackup') { setBackup(Object.assign({ enabled: false, hour: 2, minute: 0, maxPatients: 250 }, msg.value || {})).then(scheduleBackupAlarm).then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === 'mlsRunBackupNow') { runNightlyBackup('manual').then(sendResponse); return true; }
});
