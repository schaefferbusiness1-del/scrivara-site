try { importScripts('feat_codes_driver.js'); } catch (e) {}
function mlsHostOnly(u){ try { return new URL(u).hostname; } catch (e) { return ''; } }
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

// ---- Procedure-template prep driver (injected, runs per frame) ----
// Drives athenaOne so the op-note has a destination: PE tab -> Procedure
// Documentation -> add the chosen procedure template (e.g. "Injection Generic
// Template") -> leaves the editable skeleton box ready. The EXISTING note paster
// (mlsNotePaster) then ERASES that skeleton and inserts the op-note. NEVER clicks
// Save/Sign. Self-contained (no out-of-scope refs) for executeScript injection.
// mode 'probe' = READ-ONLY (no clicks): report what is reachable/present.
// mode 'prep'  = perform the add-template sequence (clicks navigation only).
async function mlsAthenaPrepProcTemplate(params, mode) {
  params = params || {}; mode = mode || 'prep';
  var sectionName = String(params.sectionName || 'Procedure Documentation');
  var template = String(params.template || 'Injection Generic Template');
  var tabName = String(params.tab || 'PE');
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function vis(el) { try { var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05; } catch (e) { return true; } }
  function txt(el) { return ((el && (el.textContent || el.innerText)) || '').replace(/\s+/g, ' ').trim(); }
  function clickEl(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) {
      try { el.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {}
    });
    try { el.click(); } catch (e) {}
  }
  function nodes(sel) { try { return [].slice.call(document.querySelectorAll(sel)); } catch (e) { return []; } }
  // shortest visible element whose text matches re (so we hit the label, not a big container)
  function findByText(re, sel) {
    var els = nodes(sel || 'button,a,[role=button],[role=tab],[role=menuitem],[role=option],li,span,div,td');
    var hits = [];
    for (var i = 0; i < els.length; i++) { var el = els[i]; if (!vis(el)) continue; var t = txt(el); if (t && t.length <= 90 && re.test(t)) hits.push({ el: el, t: t, len: t.length }); }
    hits.sort(function (a, b) { return a.len - b.len; });
    return hits;
  }
  // the editable Injection-template skeleton box (INFORMED CONSENT / PROCEDURE / DISCUSSION)
  function findTemplateBox() {
    var eds = nodes('textarea,[contenteditable=""],[contenteditable="true"]').filter(vis);
    var best = null, bs = -1;
    for (var i = 0; i < eds.length; i++) {
      var el = eds[i];
      var c = (el.value != null ? el.value : (el.innerText || el.textContent || ''));
      var lo = String(c).toLowerCase();
      var r = el.getBoundingClientRect(), s = 0;
      if (/informed consent/.test(lo)) s += 50;
      if (/\bprocedure\b/.test(lo)) s += 18;
      if (/\bdiscussion\b/.test(lo)) s += 18;
      if (/sterile|injection|tolerated the procedure|dressing was applied/.test(lo)) s += 15;
      // a sizeable box sitting under a "Procedure Documentation" heading also counts
      try { var h = el.closest && el.closest('section,div,form'); if (h && new RegExp(sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(h.textContent || '')) s += 12; } catch (e) {}
      s += Math.min(r.width * r.height, 300000) / 25000;
      if (s > bs) { bs = s; best = el; }
    }
    return (best && bs >= 12) ? { el: best, score: Math.round(bs) } : null;
  }
  function sectionReachable() {
    // a visible "Procedure Documentation" heading/section already on screen
    return findByText(new RegExp(sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'h1,h2,h3,h4,h5,h6,legend,[role=heading],div,span,a,button').length > 0;
  }

  // ---------- PROBE (read-only) ----------
  var existing = findTemplateBox();
  var tabHit = findByText(new RegExp('^' + tabName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), 'a,button,[role=tab],[role=button],li,span')[0] || null;
  var observ = {
    url: location.href, frame: (function () { try { return window.top === window; } catch (e) { return false; } })(),
    templatePresent: !!existing, templateScore: existing ? existing.score : 0,
    sectionReachable: sectionReachable(), tabFound: !!tabHit, tabName: tabName,
    sectionName: sectionName, template: template
  };
  if (mode === 'probe') { return { ok: true, mode: 'probe', ready: !!existing, observed: observ }; }

  // ---------- PREP (navigation clicks only; never Save/Sign) ----------
  // 0) already there -> nothing to do; the paster will erase+fill it.
  if (existing) return { ok: true, ready: true, alreadyPresent: true, step: 'present', observed: observ };

  var steps = [];
  var secRe = new RegExp(sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  // 1) open the tab dropdown (the caret beside the tab is what opens the menu) and choose the section.
  if (!sectionReachable()) {
    var openers = [];
    nodes('[aria-haspopup],button[aria-expanded],[class*=caret],[class*=dropdown],[class*=disclosure]').filter(vis).forEach(function (e) { openers.push(e); });
    if (tabHit) openers.push(tabHit.el);  // the tab label itself, as a fallback opener
    var secItem = null;
    for (var oi = 0; oi < openers.length && !secItem; oi++) {
      clickEl(openers[oi]); steps.push('open-attempt'); await sleep(450);
      secItem = findByText(secRe, '[role=menuitem],[role=option],li,a,button,div')[0];
      if (secItem || sectionReachable()) break;
    }
    if (secItem) { clickEl(secItem.el); steps.push('clicked-section'); await sleep(700); }
    else if (!sectionReachable()) return { ok: false, ready: false, step: 'section', steps: steps, msg: 'Could not reach "' + sectionName + '" from the ' + tabName + ' tab.', observed: observ };
  }
  if (findTemplateBox()) return { ok: true, ready: true, step: 'section-had-box', steps: steps };

  // 2) open the add/picker control and select the template by typeahead.
  var addCtrl = findByText(/add|\+|procedure documentation|search|select a procedure|choose/i, 'button,[role=button],a,input,[role=combobox]')[0];
  // prefer a search/typeahead input if present
  var input = nodes('input[type=text],input:not([type]),[role=combobox] input,[contenteditable=""]').filter(vis)[0] || null;
  if (addCtrl) { clickEl(addCtrl.el); steps.push('opened-picker'); await sleep(450); input = nodes('input[type=text],input:not([type]),[role=combobox] input').filter(vis)[0] || input; }
  if (input) {
    try { input.focus(); } catch (e) {}
    try {
      var pr = (input.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(input, template); else input.value = template;
    } catch (e) { try { input.value = template; } catch (e2) {} }
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    steps.push('typed-template'); await sleep(800);
  }
  // 3) pick the matching option from the typeahead list.
  var opt = findByText(new RegExp(template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '[role=option],li,.option,.item,td,a,button,div')[0]
         || findByText(/injection generic template|injection/i, '[role=option],li,.option,.item,td,a,button,div')[0];
  if (opt) { clickEl(opt.el); steps.push('picked-template'); await sleep(900); }
  else return { ok: false, ready: false, step: 'pick', steps: steps, msg: 'Opened Procedure Documentation but could not find the "' + template + '" option to add.', observed: observ };

  // 4) wait for the editable skeleton box to render.
  for (var w = 0; w < 8; w++) { if (findTemplateBox()) return { ok: true, ready: true, step: 'added', steps: steps }; await sleep(400); }
  return { ok: false, ready: false, step: 'render', steps: steps, msg: 'Added the template but the editable box did not appear in time.', observed: observ };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mlsRobustType: mlsRobustType, mlsFieldScanner: mlsFieldScanner, mlsNotePaster: mlsNotePaster, mlsRouteSection: mlsRouteSection, mlsSegmentNote: mlsSegmentNote, mlsMatchPatients: mlsMatchPatients, mlsReadChartIdentity: mlsReadChartIdentity, mlsReadActivePatient: mlsReadActivePatient, mlsAthenaPrepProcTemplate: mlsAthenaPrepProcTemplate };
}

// ---- Procedure-template PREP handler (op-note writeback step 1) ----
// Drives athenaOne to add the chosen procedure template so the op-note has a
// destination box, OR (mode 'probe') reports READ-ONLY what is reachable. The
// actual op-note text is then written by the existing verified paste path
// (mlsAppPasteNote), which erases the skeleton and inserts the note. NEVER Save/Sign.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mlsAppPrepProcTemplateRequest') return;
  (async () => {
    try {
      const params = msg.params || {};
      const mode = msg.mode === 'probe' ? 'probe' : 'prep';
      const isMls = (u) => /mlsscribe\.com/.test(u || '');
      let emrTab = null;
      const su = (sender && sender.tab && sender.tab.url) || '';
      if (sender && sender.tab && /^https?:/.test(su) && !isMls(su)) emrTab = sender.tab;
      if (!emrTab) { const tabs = await chrome.tabs.query({}); const c = tabs.filter(t => /^https?:/.test(t.url || '') && !isMls(t.url || '')); c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); emrTab = c[0]; }
      if (!emrTab) return sendResponse({ ok: false, error: 'No EMR/chart tab is open. Open the patient encounter in athenaOne, then try again.' });
      let results = [];
      try { results = await chrome.scripting.executeScript({ target: { tabId: emrTab.id, allFrames: true }, func: mlsAthenaPrepProcTemplate, args: [params, mode] }); }
      catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: emrTab.id }, func: mlsAthenaPrepProcTemplate, args: [params, mode] }); }
      let best = null;
      const score = (x) => (x.ready ? 100 : 0) + (x.observed && x.observed.sectionReachable ? 5 : 0) + (x.observed && x.observed.tabFound ? 2 : 0) + ((x.steps || []).length);
      (results || []).forEach(r => { const v = r && r.result; if (!v) return; if (!best || score(v) > score(best)) best = v; });
      sendResponse(best || { ok: false, error: 'Could not run the procedure-template step in any frame.' });
    } catch (e) { sendResponse({ ok: false, error: 'Prep failed: ' + (e && e.message || e) }); }
  })();
  return true;
});


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
  
  /* === MLS provider extractor (schedule provider capture) === */
/* mlsProv — schedule provider extractor (worker side), inlined into background.js. */
var mlsProv = (function () {
  'use strict';


  var RE_TIME = /\b(\d{1,2}):(\d{2})\s*([ap]\.?\s?m\.?)?\b/i;
  var RE_TIME_G = /\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?\b/gi;
  var RE_CRED = /(?:^|[^A-Za-z])(MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC)(?:[^A-Za-z]|$)/;
  var CRED_I = /^(md|do|np|pa|pac|aprn|fnp|dnp|agnp|whnp|pmhnp|rn|lpn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/;
  var RE_APPTWORD = /\bappointment/i;
  var RE_NAMECOMMA = /([A-Z][A-Za-z'’-]+)\s*,\s*([A-Z][A-Za-z'’-]+)/;
  var STOP = /^(am|pm|new|est|established|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|consultation|annual|physical|wellness|exam|sick|nurse|lab|labs|injection|inj|procedure|recheck|np|min|mins|minute|minutes|arrived|checkedin|checked|scheduled|confirmed|cancelled|canceled|noshow|no|show|room|status|reason|provider|patient|time|type|resource|rendering|department|dept|appt|appts|total|appointments)$/i;

  function S(x) { return x == null ? '' : String(x); }
  function clean(s) { return S(s).replace(/\s+/g, ' ').trim(); }

  function nameTokens(name) {
    return clean(name).toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/)
      .filter(function (t) { return t && t.length > 1 && !STOP.test(t) && !CRED_I.test(t); });
  }
  function hasTime(s) { return RE_TIME.test(S(s)); }
  function firstTime(s) { var m = S(s).match(RE_TIME_G); return m ? clean(m[0]) : ''; }

  function cleanProvider(s) {
    var t = clean(s);
    t = t.replace(/[•‣▪●>*\-–—]+\s*$/g, '');
    t = t.replace(/[-–—:|(]*\s*\d+\s*appointments?\b.*$/i, '');
    t = t.replace(/\b\d+\s*appointments?\b/i, '');
    t = t.replace(/\(\s*\d+\s*\)\s*$/, '');
    t = t.replace(/[\s,;:|–—-]+$/, '');
    return clean(t);
  }

  function looksLikeProviderHeader(line) {
    var t = clean(line);
    if (!t || t.length > 80) return false;
    if (hasTime(t)) return false;
    var hasCred = RE_CRED.test(t);
    var hasApptWord = RE_APPTWORD.test(t);
    var hasName = RE_NAMECOMMA.test(t) || /[A-Z][a-z]+[ _][A-Z][a-z]+/.test(t);
    if ((hasCred && hasName) || (hasApptWord && hasName)) return true;
    if (hasCred && RE_NAMECOMMA.test(t) && t.split(/\s+/).length <= 5) return true;
    return false;
  }

  function patientNameFromRow(line) {
    var t = clean(line);
    var mc = t.match(RE_NAMECOMMA);
    if (mc) return clean(mc[0]);
    var afterTime = t.replace(RE_TIME_G, ' ');
    var words = afterTime.split(/\s+/).filter(function (w) { return /[A-Za-z]/.test(w); });
    var picked = [];
    for (var i = 0; i < words.length && picked.length < 3; i++) {
      var w = words[i].replace(/[^A-Za-z'’-]/g, '');
      if (!w) continue;
      if (STOP.test(w) || CRED_I.test(w.toLowerCase())) { if (picked.length) break; else continue; }
      if (/^[A-Z]/.test(w)) picked.push(w); else if (picked.length) break;
    }
    return picked.join(' ');
  }

  function mlsExtractScheduleFromText(text) {
    var out = { appts: [], providers: [], diag: { strategy: 'text', lineCount: 0, headerCount: 0, apptCount: 0, providerCount: 0, credsSeen: [], providerNames: [] } };
    try {
      var raw = S(text);
      if (!raw.trim()) return out;
      var lines = raw.split(/\r?\n/).map(clean).filter(function (l) { return l.length; });
      out.diag.lineCount = lines.length;
      var current = '';
      var provSet = {}, provOrder = [], credSet = {};
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (looksLikeProviderHeader(ln)) {
          var p = cleanProvider(ln);
          if (p) {
            current = p;
            if (!provSet[p.toLowerCase()]) { provSet[p.toLowerCase()] = 1; provOrder.push(p); }
            var cm = ln.match(RE_CRED); if (cm && cm[1]) credSet[cm[1].toUpperCase()] = 1;
            out.diag.headerCount++;
          }
          continue;
        }
        if (hasTime(ln)) {
          var nm = patientNameFromRow(ln);
          if (nm) out.appts.push({ time: firstTime(ln), name: nm, provider: current || '' });
        }
      }
      var withAppts = {};
      out.appts.forEach(function (a) { if (a.provider) withAppts[a.provider.toLowerCase()] = a.provider; });
      var provs = Object.keys(withAppts).length ? provOrder.filter(function (p) { return withAppts[p.toLowerCase()]; }) : provOrder;
      out.providers = provs;
      out.diag.apptCount = out.appts.length;
      out.diag.providerCount = provs.length;
      out.diag.providerNames = provs.slice(0, 20);
      out.diag.credsSeen = Object.keys(credSet);
    } catch (e) { out.diag.err = S(e && e.message || e).slice(0, 120); }
    return out;
  }

  function txt(el) { try { return clean(el.textContent); } catch (e) { return ''; } }

  function mlsExtractScheduleFromDom(doc) {
    var out = { appts: [], providers: [], diag: { strategy: 'dom', tables: 0, rowsScanned: 0, apptCount: 0, providerCount: 0, via: '', providerNames: [], credsSeen: [] } };
    try {
      if (!doc || !doc.querySelectorAll) return out;
      var provSet = {}, provOrder = [], credSet = {};
      function noteProv(p) {
        p = cleanProvider(p);
        if (p && /[A-Za-z]/.test(p) && p.length <= 60 && !provSet[p.toLowerCase()]) { provSet[p.toLowerCase()] = 1; provOrder.push(p); }
        if (p) { var cm = p.match(RE_CRED); if (cm && cm[1]) credSet[cm[1].toUpperCase()] = 1; }
        return p;
      }

      var grids = [].slice.call(doc.querySelectorAll('table, [role="grid"], [role="table"]'));
      out.diag.tables = grids.length;
      for (var g = 0; g < grids.length && !out.appts.length; g++) {
        var grid = grids[g];
        var headerCells = [].slice.call(grid.querySelectorAll('thead th, [role="columnheader"]'));
        var rows = [].slice.call(grid.querySelectorAll('tbody tr, [role="row"]'));
        if (!rows.length) rows = [].slice.call(grid.querySelectorAll('tr'));
        if (!headerCells.length && rows.length) headerCells = [].slice.call(rows[0].querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"]'));
        var provIdx = -1, nameIdx = -1;
        headerCells.forEach(function (h, idx) {
          var ht = txt(h).toLowerCase();
          if (provIdx < 0 && /(provider|rendering|resource|clinician|scheduling provider|doctor|seen by|with)/.test(ht) && !/patient/.test(ht)) provIdx = idx;
          if (nameIdx < 0 && /(patient|name)/.test(ht)) nameIdx = idx;
        });
        if (provIdx < 0) continue;
        rows.forEach(function (r) {
          out.diag.rowsScanned++;
          var cells = [].slice.call(r.querySelectorAll('th, td, [role="cell"], [role="gridcell"]'));
          if (!cells.length) return;
          var rowText = txt(r);
          if (!hasTime(rowText)) return;
          var prov = cells[provIdx] ? noteProv(txt(cells[provIdx])) : '';
          var nm = nameIdx >= 0 && cells[nameIdx] ? txt(cells[nameIdx]) : patientNameFromRow(rowText);
          if (nm) out.appts.push({ time: firstTime(rowText), name: clean(nm), provider: prov || '' });
        });
        if (out.appts.length) out.diag.via = 'table-column';
      }

      if (!out.appts.length) {
        var all = [].slice.call(doc.querySelectorAll('div,li,tr,section,article,a,span,p'));
        var seq = [];
        all.forEach(function (el) {
          var own = txt(el);
          if (!own || own.length > 400) return;
          if (own.length <= 80 && looksLikeProviderHeader(own) && el.querySelectorAll('*').length <= 6) {
            seq.push({ kind: 'prov', el: el, text: own });
          } else if (hasTime(own) && own.length < 300 && patientNameFromRow(own)) {
            var childHasBoth = false;
            for (var c = 0; c < el.children.length; c++) {
              var ct = txt(el.children[c]);
              if (hasTime(ct) && patientNameFromRow(ct)) { childHasBoth = true; break; }
            }
            if (!childHasBoth) seq.push({ kind: 'appt', el: el, text: own });
          }
        });
        var cur = '';
        seq.forEach(function (n) {
          out.diag.rowsScanned++;
          if (n.kind === 'prov') { cur = noteProv(n.text); }
          else {
            var inRow = '';
            if (RE_CRED.test(n.text)) {
              var mNme = n.text.match(/([A-Z][A-Za-z'’-]+\s*,\s*[A-Z][A-Za-z'’-]+\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|RN|DPM|DDS|DMD|PHD|MBBS|OD)\b)/);
              if (mNme) inRow = noteProv(mNme[1]);
            }
            var nm2 = patientNameFromRow(n.text);
            if (nm2) out.appts.push({ time: firstTime(n.text), name: nm2, provider: inRow || cur || '' });
          }
        });
        if (out.appts.length && !out.diag.via) out.diag.via = 'grouped-dom';
      }

      var used = {};
      out.appts.forEach(function (a) { if (a.provider) used[a.provider.toLowerCase()] = a.provider; });
      out.providers = Object.keys(used).length ? provOrder.filter(function (p) { return used[p.toLowerCase()]; }) : provOrder;
      out.diag.apptCount = out.appts.length;
      out.diag.providerCount = out.providers.length;
      out.diag.providerNames = out.providers.slice(0, 20);
      out.diag.credsSeen = Object.keys(credSet);
    } catch (e) { out.diag.err = S(e && e.message || e).slice(0, 120); }
    return out;
  }

  function mlsMergeSchedule(domRes, textRes) {
    var dom = domRes || { appts: [], providers: [], diag: {} };
    var text = textRes || { appts: [], providers: [], diag: {} };
    var primary = (dom.providers && dom.providers.length) ? dom : text;
    var other = primary === dom ? text : dom;
    var seen = {}, providers = [];
    (primary.providers || []).concat(other.providers || []).forEach(function (p) {
      var k = clean(p).toLowerCase(); if (p && !seen[k]) { seen[k] = 1; providers.push(p); }
    });
    return {
      appts: primary.appts && primary.appts.length ? primary.appts : (other.appts || []),
      providers: providers,
      providerDiag: {
        source: primary === dom ? 'dom' : 'text',
        dom: dom.diag || {},
        text: text.diag || {},
        providerCount: providers.length,
        providerNames: providers.slice(0, 20)
      }
    };
  }
  return { fromText: mlsExtractScheduleFromText, fromDom: mlsExtractScheduleFromDom, merge: mlsMergeSchedule };
})();

  if (msg.type === 'mlsAppScheduleRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        // MLS fix: when MULTIPLE athenaOne tabs are open, prefer the SIGNED-IN app tab
        // (athenanet.athenahealth.com, schedule/dashboard) over a stray sign-in/auth tab
        // (anet.aws.caas.athenahealth.com / login), so the schedule read targets the real Day view.
        all.sort(function(a,b){function sc(t){var u=(t.url||"").toLowerCase();var s=0;if(/athenanet\.athenahealth\.com/.test(u))s+=100;if(/\/ax\/|dashboard|schedul|calendar|frontoffice|globalframeset/.test(u))s+=40;if(/aws\.caas|\/login|sign-?in|\/auth|\/oauth|accounts\./.test(u))s-=200;if(t.active)s+=5;return s;}return sc(b)-sc(a);});
        // Find the EMR tab by KNOWN domains, else by EMR-looking host keywords, else the
        // most-recently-active non-MLS http(s) tab. Kept broad so an Athena domain/URL change
        // doesn't break us — the real work is content-based below.
        let tab = all.find((t) => /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(t.url || ''))
               || all.find((t) => /athena|epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com/i.test(t.url || ''));
        // v1.38 truth fix: do NOT fall back to an unrelated most-recently-active tab and report it connected (phantom-tab bug).
        if (!tab) return sendResponse({ ok: false, reason: 'no-athena-tab', emr: 'none', host: '', id: msg.id, error: 'Open a signed-in athenaOne tab, then try again.' });
        const isRealAthena = /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(tab.url || '');
        // Read every frame WITH its URL so we can isolate the SCHEDULE/CALENDAR frame and
        // drop the noise (athenaText messaging, department lists) that would pollute parsing.
        // v1.45: fetch hosted config (data, not code) so selectors are tunable via the site w/o a store update.
        var __mlsCfg = null; try { var __cr = await fetch('https://mlsscribe.com/mls-assist-config.json?cb=' + Date.now()); if (__cr.ok) { __mlsCfg = await __cr.json(); } } catch (e) { __mlsCfg = null; }
        let results = [];
        try {
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            args: [ (__mlsCfg && (__mlsCfg.schedule || __mlsCfg)) || null ],
            func: (CFG) => { try { /* inject_dom.js — SELF-CONTAINED DOM schedule/provider reader.
 * This exact function body is inlined into MLS Assist background.js's executeScript
 * `func` so it runs INSIDE the athenaOne schedule frame. It must reference nothing
 * outside itself. Returns { appts:[{time,name,provider}], providers:[...], diag:{} }.
 * Read-only; PHI (patient names) stays in the user's browser; diag is PHI-free. */
function mlsSchedDomInline(doc, CFG){
  var out={appts:[],providers:[],diag:{strategy:'dom',via:'',tables:0,rowsScanned:0,apptCount:0,providerCount:0,providerNames:[],credsSeen:[]}};
  try{
    var RT=/\b(\d{1,2}):(\d{2})\s*([ap]\.?\s?m\.?)?\b/i, RTG=/\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?\b/gi;
    var RC=/(?:^|[^A-Za-z])(MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC)(?:[^A-Za-z]|$)/;
    var CI=/^(md|do|np|pa|pac|aprn|fnp|dnp|agnp|whnp|pmhnp|rn|lpn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/;
    var RA=/\bappointment/i, RN=/([A-Z][A-Za-z'’-]+)\s*,\s*([A-Z][A-Za-z'’-]+)/;
    var STOP=/^(am|pm|new|est|established|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|consultation|annual|physical|wellness|exam|sick|nurse|lab|labs|injection|inj|procedure|recheck|np|min|mins|minute|minutes|arrived|checkedin|checked|scheduled|confirmed|cancelled|canceled|noshow|no|show|room|status|reason|provider|patient|time|type|resource|rendering|department|dept|appt|appts|total|appointments)$/i;
    function cl(s){return String(s==null?'':s).replace(/\s+/g,' ').trim();}
    function ht(s){return RT.test(String(s));}
    function ft(s){var m=String(s).match(RTG);return m?cl(m[0]):'';}
    function cp(s){var t=cl(s);t=t.replace(/[•‣▪●>*\-–—]+\s*$/g,'');t=t.replace(/[-–—:|(]*\s*\d+\s*appointments?\b.*$/i,'');t=t.replace(/\b\d+\s*appointments?\b/i,'');t=t.replace(/\(\s*\d+\s*\)\s*$/,'');t=t.replace(/[\s,;:|–—-]+$/,'');t=t.replace(/\s*[Cc]lose\s*$/,'');return cl(t);}
    function lh(line){var t=cl(line);if(!t||t.length>80)return false;if(ht(t))return false;var hc=RC.test(t),ha=RA.test(t),hn=RN.test(t)||/[A-Z][a-z]+[ _][A-Z][a-z]+/.test(t);if((hc&&hn)||(ha&&hn))return true;if(hc&&RN.test(t)&&t.split(/\s+/).length<=5)return true;return false;}
    function pn(line){var t=cl(line);var mc=t.match(RN);if(mc)return cl(mc[0]);var af=t.replace(RTG,' ');var ws=af.split(/\s+/).filter(function(w){return /[A-Za-z]/.test(w);});var pk=[];for(var i=0;i<ws.length&&pk.length<3;i++){var w=ws[i].replace(/[^A-Za-z'’-]/g,'');if(!w)continue;if(STOP.test(w)||CI.test(w.toLowerCase())){if(pk.length)break;else continue;}if(/^[A-Z]/.test(w))pk.push(w);else if(pk.length)break;}return pk.join(' ');}
    function tx(el){try{return cl(el.textContent);}catch(e){return '';}}
    var provSet={},provOrder=[],credSet={};
    function np(p){p=cp(p);if(p&&/[A-Za-z]/.test(p)&&p.length<=60&&!provSet[p.toLowerCase()]){provSet[p.toLowerCase()]=1;provOrder.push(p);}if(p){var cm=p.match(RC);if(cm&&cm[1])credSet[cm[1].toUpperCase()]=1;}return p;}
    if(!doc||!doc.querySelectorAll)return out;
    // === v1.44 COORD STRATEGY: athenaOne Day view is an absolute-positioned React grid (not a
    // table); appointments are placed by x-coordinate. Bucket each appt to the provider column
    // whose x-range contains it — captures ALL providers, incl. columns scrolled off-screen
    // (still in DOM). Also reads the Day date header. Falls through to the old strategies if this
    // isn't that kind of grid. ===
    try{
      function mlsPad2(n){n=String(n);return n.length<2?('0'+n):n;}
      function mlsParseDate(s){try{var d=new Date(String(s).replace(/^[A-Za-z]+,\s*/,''));if(!isNaN(d.getTime()))return d.getFullYear()+'-'+mlsPad2(d.getMonth()+1)+'-'+mlsPad2(d.getDate());}catch(e){}return '';}
      var _dh=doc.querySelector((CFG&&CFG.dateHdrSel)||'h1.fe_c_heading--subsection');
      if(!_dh){var _hs=[].slice.call(doc.querySelectorAll('h1,h2,[class*="heading"],[class*="date"]'));for(var _i=0;_i<_hs.length;_i++){var _t0=cl(_hs[_i].textContent);if(/^[A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d\d/.test(_t0)){_dh=_hs[_i];break;}}}
      if(_dh)out.schedDate=mlsParseDate(cl(_dh.textContent));
      var _provRe=(CFG&&CFG.provReSource)?new RegExp(CFG.provReSource):/^[A-Z][A-Za-z'’.\-]+_[A-Za-z].*_(MD|DO|PA-?C|NP|CRNA|APRN|DPM|DDS|DMD)\b/;
      var _heads=[].slice.call(doc.querySelectorAll('*')).filter(function(e){var t=cl(e.textContent);return _provRe.test(t)&&t.replace(/\s/g,'').length<48&&e.children.length<=4;});
      var _cols=[],_seenC={};
      _heads.forEach(function(e){try{var r=e.getBoundingClientRect();if(r.width>20&&r.width<520&&r.top<560){var nm=cp(cl(e.textContent));var key=Math.round(r.left/8);if(nm&&!_seenC[key]){_seenC[key]=1;_cols.push({name:nm,lo:r.left,rr:r.right});}}}catch(_e){}});
      _cols.sort(function(a,b){return a.lo-b.lo;});
      if(_cols.length>=2){
        for(var _c=0;_c<_cols.length;_c++){var _nx=(_c+1<_cols.length)?_cols[_c+1].lo:(_cols[_c].rr+(_cols[_c].rr-_cols[_c].lo));_cols[_c].hi=(_cols[_c].rr<_nx)?_nx:_cols[_c].rr;}
        var _cells=[].slice.call(doc.querySelectorAll('div,li,a')).filter(function(e){var t=cl(e.textContent);return ht(t)&&t.length>10&&t.length<140&&pn(t)&&e.querySelectorAll('*').length<=8;});
        var _seenA={};
        _cells.forEach(function(e){try{var r=e.getBoundingClientRect();if(r.width<8||r.width>460)return;var t=cl(e.textContent);var nm=pn(t);if(!nm)return;var cx=r.left+Math.min(18,r.width/2);var prov='';for(var _k=0;_k<_cols.length;_k++){if(cx>=_cols[_k].lo-6&&cx<_cols[_k].hi){prov=_cols[_k].name;break;}}var key=Math.round(r.left/6)+'|'+Math.round(r.top/6);if(_seenA[key])return;_seenA[key]=1;out.appts.push({time:ft(t),name:cl(nm),provider:prov||''});}catch(_e){}});
        if(out.appts.length){var _u={};out.appts.forEach(function(a){if(a.provider)_u[a.provider]=1;});out.providers=_cols.map(function(c){return c.name;}).filter(function(n){return _u[n];});if(!out.providers.length)out.providers=_cols.map(function(c){return c.name;});out.diag.via='coord';out.diag.strategy='coord';out.diag.apptCount=out.appts.length;out.diag.providerCount=out.providers.length;out.diag.providerNames=out.providers.slice(0,20);return out;}
      }
    }catch(_ce){out.diag.coordErr=String(_ce&&_ce.message||_ce).slice(0,100);}
    var grids=[].slice.call(doc.querySelectorAll('table, [role="grid"], [role="table"]'));
    out.diag.tables=grids.length;
    for(var g=0;g<grids.length&&!out.appts.length;g++){
      var grid=grids[g];
      var hc=[].slice.call(grid.querySelectorAll('thead th, [role="columnheader"]'));
      var rows=[].slice.call(grid.querySelectorAll('tbody tr, [role="row"]'));
      if(!rows.length)rows=[].slice.call(grid.querySelectorAll('tr'));
      if(!hc.length&&rows.length)hc=[].slice.call(rows[0].querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"]'));
      var pi=-1,ni=-1;
      hc.forEach(function(h,idx){var t=tx(h).toLowerCase();if(pi<0&&/(provider|rendering|resource|clinician|scheduling provider|doctor|seen by|with)/.test(t)&&!/patient/.test(t))pi=idx;if(ni<0&&/(patient|name)/.test(t))ni=idx;});
      if(pi<0)continue;
      rows.forEach(function(r){out.diag.rowsScanned++;var cells=[].slice.call(r.querySelectorAll('th, td, [role="cell"], [role="gridcell"]'));if(!cells.length)return;var rt=tx(r);if(!ht(rt))return;var prov=cells[pi]?np(tx(cells[pi])):'';var nm=ni>=0&&cells[ni]?tx(cells[ni]):pn(rt);if(nm)out.appts.push({time:ft(rt),name:cl(nm),provider:prov||''});});
      if(out.appts.length)out.diag.via='table-column';
    }
    if(!out.appts.length){
      var all=[].slice.call(doc.querySelectorAll('div,li,tr,section,article,a,span,p'));
      var seq=[];
      all.forEach(function(el){var own=tx(el);if(!own||own.length>400)return;if(own.length<=80&&lh(own)&&el.querySelectorAll('*').length<=6){seq.push({k:'p',t:own});}else if(ht(own)&&own.length<300&&pn(own)){var cb=false;for(var c=0;c<el.children.length;c++){var ct=tx(el.children[c]);if(ht(ct)&&pn(ct)){cb=true;break;}}if(!cb)seq.push({k:'a',t:own});}});
      var cur='';
      seq.forEach(function(n){out.diag.rowsScanned++;if(n.k==='p'){cur=np(n.t);}else{var inRow='';if(RC.test(n.t)){var mN=n.t.match(/([A-Z][A-Za-z'’-]+\s*,\s*[A-Z][A-Za-z'’-]+\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|RN|DPM|DDS|DMD|PHD|MBBS|OD)\b)/);if(mN)inRow=np(mN[1]);}var nm2=pn(n.t);if(nm2)out.appts.push({time:ft(n.t),name:nm2,provider:inRow||cur||''});}});
      if(out.appts.length&&!out.diag.via)out.diag.via='grouped-dom';
    }
    var used={};out.appts.forEach(function(a){if(a.provider)used[a.provider.toLowerCase()]=a.provider;});
    out.providers=Object.keys(used).length?provOrder.filter(function(p){return used[p.toLowerCase()];}):provOrder;
    out.diag.apptCount=out.appts.length;out.diag.providerCount=out.providers.length;out.diag.providerNames=out.providers.slice(0,20);out.diag.credsSeen=Object.keys(credSet);
  }catch(e){out.diag.err=String(e&&e.message||e).slice(0,120);}
  return out;
}
 var T = (document.body && document.body.innerText || '').slice(0, 22000); var s = null; try { s = mlsSchedDomInline(document, CFG); } catch (e) { s = { diag: { err: String(e && e.message || e).slice(0,120) } }; } return { u: location.href, t: T, s: s }; } catch (e) { return { u: '', t: '', s: null }; } }
          });
        } catch (e) {
          results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 22000), s: null }) });
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
        var __mlsTS = (typeof mlsProv!=='undefined') ? mlsProv.fromText((pick && pick.t) || '') : {appts:[],providers:[],diag:{}}; var __mlsM = (typeof mlsProv!=='undefined') ? mlsProv.merge(pick && pick.s, __mlsTS) : {appts:[],providers:[],diag:{}}; sendResponse({ ok: true, emr: isRealAthena ? 'athena' : 'other-emr', host: mlsHostOnly(pick.u || tab.url), id: msg.id, text: ((tab.title ? ('[' + tab.title + ']\n') : '') + (pick.t || '')).slice(0, 22000), url: pick.u || tab.url, title: tab.title, frames: frames.length, appts: __mlsM.appts, providers: __mlsM.providers, providerDiag: __mlsM.providerDiag, schedDate: (pick && pick.s && pick.s.schedDate) || '' });
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
        // MLS fix: when MULTIPLE athenaOne tabs are open, prefer the SIGNED-IN app tab
        // (athenanet.athenahealth.com, schedule/dashboard) over a stray sign-in/auth tab
        // (anet.aws.caas.athenahealth.com / login), so the schedule read targets the real Day view.
        all.sort(function(a,b){function sc(t){var u=(t.url||"").toLowerCase();var s=0;if(/athenanet\.athenahealth\.com/.test(u))s+=100;if(/\/ax\/|dashboard|schedul|calendar|frontoffice|globalframeset/.test(u))s+=40;if(/aws\.caas|\/login|sign-?in|\/auth|\/oauth|accounts\./.test(u))s-=200;if(t.active)s+=5;return s;}return sc(b)-sc(a);});
        // Same broad EMR-tab finder as the schedule path: known Athena domains, else EMR-ish
        // host keywords, else the most-recently-active non-MLS http(s) tab.
        let tab = all.find((t) => /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(t.url || ''))
               || all.find((t) => /athena|epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|report|claim|billing|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com/i.test(t.url || ''));
        // v1.38 truth fix: no arbitrary-tab fallback for a positive result (phantom-tab bug).
        if (!tab) return sendResponse({ ok: false, reason: 'no-athena-tab', emr: 'none', host: '', id: msg.id, error: 'Open a signed-in athenaOne report tab, then try again.' });
        const isRealAthena = /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(tab.url || '');
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
        sendResponse({ ok: true, emr: isRealAthena ? 'athena' : 'other-emr', host: mlsHostOnly(best.f.u || tab.url), id: msg.id, text: text, url: best.f.u || tab.url, title: tab.title, frames: frames.length, bestScore: Math.round(best.s) });
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
        // MLS fix: when MULTIPLE athenaOne tabs are open, prefer the SIGNED-IN app tab
        // (athenanet.athenahealth.com, schedule/dashboard) over a stray sign-in/auth tab
        // (anet.aws.caas.athenahealth.com / login), so the schedule read targets the real Day view.
        all.sort(function(a,b){function sc(t){var u=(t.url||"").toLowerCase();var s=0;if(/athenanet\.athenahealth\.com/.test(u))s+=100;if(/\/ax\/|dashboard|schedul|calendar|frontoffice|globalframeset/.test(u))s+=40;if(/aws\.caas|\/login|sign-?in|\/auth|\/oauth|accounts\./.test(u))s-=200;if(t.active)s+=5;return s;}return sc(b)-sc(a);});
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
        // MLS fix: when MULTIPLE athenaOne tabs are open, prefer the SIGNED-IN app tab
        // (athenanet.athenahealth.com, schedule/dashboard) over a stray sign-in/auth tab
        // (anet.aws.caas.athenahealth.com / login), so the schedule read targets the real Day view.
        all.sort(function(a,b){function sc(t){var u=(t.url||"").toLowerCase();var s=0;if(/athenanet\.athenahealth\.com/.test(u))s+=100;if(/\/ax\/|dashboard|schedul|calendar|frontoffice|globalframeset/.test(u))s+=40;if(/aws\.caas|\/login|sign-?in|\/auth|\/oauth|accounts\./.test(u))s-=200;if(t.active)s+=5;return s;}return sc(b)-sc(a);});
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
        // MLS fix: when MULTIPLE athenaOne tabs are open, prefer the SIGNED-IN app tab
        // (athenanet.athenahealth.com, schedule/dashboard) over a stray sign-in/auth tab
        // (anet.aws.caas.athenahealth.com / login), so the schedule read targets the real Day view.
        all.sort(function(a,b){function sc(t){var u=(t.url||"").toLowerCase();var s=0;if(/athenanet\.athenahealth\.com/.test(u))s+=100;if(/\/ax\/|dashboard|schedul|calendar|frontoffice|globalframeset/.test(u))s+=40;if(/aws\.caas|\/login|sign-?in|\/auth|\/oauth|accounts\./.test(u))s-=200;if(t.active)s+=5;return s;}return sc(b)-sc(a);});
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
        // MLS fix: when MULTIPLE athenaOne tabs are open, prefer the SIGNED-IN app tab
        // (athenanet.athenahealth.com, schedule/dashboard) over a stray sign-in/auth tab
        // (anet.aws.caas.athenahealth.com / login), so the schedule read targets the real Day view.
        all.sort(function(a,b){function sc(t){var u=(t.url||"").toLowerCase();var s=0;if(/athenanet\.athenahealth\.com/.test(u))s+=100;if(/\/ax\/|dashboard|schedul|calendar|frontoffice|globalframeset/.test(u))s+=40;if(/aws\.caas|\/login|sign-?in|\/auth|\/oauth|accounts\./.test(u))s-=200;if(t.active)s+=5;return s;}return sc(b)-sc(a);});
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

/* === MLS Assist v1.34 — Copy-every-visit driver (APPEND-ONLY to background.js) ==
 * Self-contained. Adds its own chrome.runtime.onMessage handler for
 * mlsAppAllVisitsRequest; does not modify existing handlers. Genuinely walks the
 * OPEN patient's encounters/visits list in athenaOne (frame-aware, content-scored),
 * reads each encounter's real content, and returns {ok, identity, visits[], diag}.
 *
 * v1.34 changes vs v1.32:
 *  - Frame-aware enumeration: scores every frame's candidate row-groups by
 *    encounter-likeness (date + type-keyword + clickable + code signals), not just
 *    "has a date", and picks the single best frame+group.
 *  - Two read paths: (A) EXPANDED — if rows already carry real content, read them
 *    in place with NO clicks (safest, read-only); (B) CLICK — only for thin rows,
 *    open each row, read the detail pane (content-scored across frames). Falls back
 *    A->B per-row when an expanded row is too thin.
 *  - HONEST progress: emits a per-visit line ONLY after a visit with REAL content
 *    is actually read; total M is the real enumerated count. Never a pre-counted
 *    "reading N of M" with no data behind it.
 *  - HONEST failure: if no encounters list is recognized, returns ok:false with a
 *    clear message — never a fabricated count.
 *  - SELF-DIAGNOSTIC: always attaches result.diag, a fully REDACTED structural
 *    fingerprint of the chart DOM (frame hosts, candidate selectors, row tag/class
 *    signatures, counts, and date/CPT/ICD booleans) — NO patient text, names, DOBs,
 *    dates, or codes — so the selectors can be tuned to a real chart from one run.
 *    The redacted diag is also saved to chrome.storage.local 'mlsAthenaVisitsDiag'.
 *  - READ-ONLY: clicks ONLY dated encounter rows; never Save/Sign/Submit/etc.
 *    (excludeClickLabels guard). Selectors tunable via chrome.storage.local
 *    'mlsAthenaVisitsCfg'. */
(function () {
  'use strict';
  try { if (self.__mlsAllVisitsHandler) return; self.__mlsAllVisitsHandler = 1; } catch (e) {}

  var ORCH_DEFAULT = { maxVisits: 60, waitMs: 1400, initialWaitMs: 1000 };
  var EMR_RE = /(athenahealth|athenanet|athenaone|athena\.io|\.px\.athena)/i;

  /* CANONICAL self-contained injected driver. Passed to chrome.scripting
   * .executeScript({func: mlsVisitsDriverFn}) — must reference no outer scope and
   * no eval (athenaOne CSP-safe). Read-only: only clicks dated encounter rows,
   * never Save/Sign/Submit. Embedded verbatim in background.js. */
  function mlsVisitsDriverFn(op, cfg, idx) {
    cfg = cfg || {};
    var DEFAULT = {
      rowSelectors: [
        'tr', '[role="row"]', 'li',
        '.encounter', '.encounter-row', '.encounterrow', '[data-encounter-id]',
        '[data-encounterid]', '[id*="encounter" i]', '[class*="encounter" i]',
        '.visit', '.visit-row', '[class*="visit" i]', '[class*="timeline" i] li',
        '.athena-encounter', '.chart-encounter', '.documentencounter'
      ],
      detailSelectors: [
        '[role="main"]', 'main', '.encounter-detail', '.encounterdetail',
        '.documentation', '.clinical', 'article', '.chart-detail', '.notesection',
        '[class*="encounterbody" i]', '[class*="notebody" i]', '[class*="document" i]',
        '[id*="encounter" i]', '.assessment', '.hpi'
      ],
      typeKeywords: [
        'office visit', 'encounter', 'telehealth', 'follow', 'follow-up', 'f/u',
        'new patient', 'established', 'consult', 'procedure', 'injection', 'block',
        'ablation', 'epidural', 'facet', 'esi', 'rfa', 'evaluation', 'eval',
        'visit', 'exam', 'phone', 'lab', 'imaging', 'mri', 'x-ray', 'progress note',
        'preop', 'postop', 'pre-op', 'post-op', 'surgery'
      ],
      excludeClickLabels: [
        'save', 'sign', 'finalize', 'post', 'bill', 'submit claim', 'submit',
        'delete', 'lock', 'addend', 'amend', 'discard', 'cancel appointment',
        'close encounter', 'check out', 'checkout'
      ],
      maxVisits: 60,
      minRealLen: 60
    };
    for (var k in DEFAULT) { if (cfg[k] == null) cfg[k] = DEFAULT[k]; }
    var DATE_RE = /(?:^|[^\d])(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})(?!\d)/;
    var CPT_RE = /\b\d{5}\b/g, ICD_RE = /\b[A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/g;
    function txt(el) { return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim(); }
    function low(s) { return String(s || '').toLowerCase(); }
    function excluded(s) { s = low(s); for (var i = 0; i < cfg.excludeClickLabels.length; i++) { if (s.indexOf(cfg.excludeClickLabels[i]) >= 0) return true; } return false; }
    function hasType(s) { s = low(s); for (var i = 0; i < cfg.typeKeywords.length; i++) { if (s.indexOf(cfg.typeKeywords[i]) >= 0) return true; } return false; }
    function hasDate(s) { return DATE_RE.test(String(s || '')); }
    function hasCpt(s) { CPT_RE.lastIndex = 0; return CPT_RE.test(String(s || '')); }
    function hasIcd(s) { ICD_RE.lastIndex = 0; return ICD_RE.test(String(s || '')); }
    function codes(s, re) { var out = [], m; re.lastIndex = 0; while ((m = re.exec(String(s || '')))) { var c = m[0].toUpperCase(); if (out.indexOf(c) < 0) out.push(c); if (out.length > 40) break; } return out; }
    function clickable(n) { try { return !!(n.querySelector && n.querySelector('a[href],button,[role="link"],[role="button"],[onclick],td a, td')); } catch (e) { return false; } }

    // Score a single candidate row's text for "looks like an encounter row".
    function rowScore(t) {
      if (!t) return 0;
      var s = 0;
      if (hasDate(t)) s += 3;
      if (hasType(t)) s += 2;
      if (hasCpt(t)) s += 1;
      if (hasIcd(t)) s += 1;
      if (t.length >= 12 && t.length <= 400) s += 1;
      return s;
    }

    // Build candidate groups: for each selector, group matching nodes by parent,
    // keep groups whose members look like dated encounter rows; return scored groups.
    function candidateGroups() {
      var groups = [];
      for (var s = 0; s < cfg.rowSelectors.length; s++) {
        var nodes;
        try { nodes = Array.prototype.slice.call(document.querySelectorAll(cfg.rowSelectors[s])); } catch (e) { continue; }
        if (!nodes.length) continue;
        var byParent = new Map();
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i], t = txt(n);
          if (t.length < 8 || t.length > 1200) continue;
          if (!hasDate(t)) continue;
          if (excluded(t)) continue;
          var par = n.parentElement || n;
          if (!byParent.has(par)) byParent.set(par, []);
          byParent.get(par).push(n);
        }
        byParent.forEach(function (rows, par) {
          if (rows.length < 2) return; // a list has multiple dated rows
          var sc = 0, withType = 0, withCode = 0, withClick = 0, lens = [];
          for (var j = 0; j < rows.length; j++) {
            var rt = txt(rows[j]);
            sc += rowScore(rt);
            if (hasType(rt)) withType++;
            if (hasCpt(rt) || hasIcd(rt)) withCode++;
            if (clickable(rows[j])) withClick++;
            lens.push(rt.length);
          }
          lens.sort(function (a, b) { return a - b; });
          var median = lens[Math.floor(lens.length / 2)] || 0;
          // group score: per-row signal * count, with bonuses for type/click consistency
          var groupScore = sc + rows.length * 2 + withType + Math.min(withClick, rows.length);
          groups.push({
            selector: cfg.rowSelectors[s], parent: par, rows: rows,
            count: rows.length, score: groupScore, withType: withType,
            withCode: withCode, withClick: withClick, median: median
          });
        });
      }
      groups.sort(function (a, b) { return b.score - a.score; });
      return groups;
    }

    function bestGroup() { var g = candidateGroups(); return g.length ? g[0] : null; }

    // ---- redacted structural fingerprint (NO PHI) ----------------------------
    function sigOf(node) {
      var classes = [];
      try { classes = (node.className && node.className.baseVal != null ? node.className.baseVal : (node.className || '')).toString().split(/\s+/).filter(Boolean).slice(0, 6); } catch (e) {}
      var childTags = {};
      try {
        var ch = node.children || [];
        for (var i = 0; i < ch.length && i < 30; i++) { var tg = (ch[i].tagName || '').toLowerCase(); if (tg) childTags[tg] = (childTags[tg] || 0) + 1; }
      } catch (e) {}
      var attrKeys = [];
      try { for (var a = 0; a < node.attributes.length && a < 12; a++) { var an = node.attributes[a].name; if (an !== 'class' && an !== 'style') attrKeys.push(an); } } catch (e) {}
      var t = txt(node);
      return {
        tag: (node.tagName || '').toLowerCase(),
        classes: classes,            // CSS class NAMES only (structural, no PHI)
        childTags: childTags,        // counts of child element tags
        attrKeys: attrKeys,          // attribute NAMES only (no values)
        textLen: t.length,           // length only (no text)
        hasDate: hasDate(t), hasCpt: hasCpt(t), hasIcd: hasIcd(t), hasType: hasType(t)
      };
    }
    function diagnose() {
      var host = '';
      try { host = location.hostname || ''; } catch (e) {}
      var groups = candidateGroups();
      var cands = groups.slice(0, 4).map(function (g) {
        return {
          selector: g.selector, count: g.count, score: g.score,
          withType: g.withType, withCode: g.withCode, withClick: g.withClick,
          medianLen: g.median, rowSig: g.rows[0] ? sigOf(g.rows[0]) : null
        };
      });
      // generic counts to see what's present even when no group qualified
      function cnt(sel) { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } }
      return {
        host: host,
        frameDepth: (function () { try { return window.top === window ? 0 : 1; } catch (e) { return 1; } })(),
        counts: { tr: cnt('tr'), role_row: cnt('[role="row"]'), li: cnt('li'), tables: cnt('table'), iframes: cnt('iframe'), encounterish: cnt('[class*="encounter" i],[id*="encounter" i]'), visitish: cnt('[class*="visit" i]') },
        groupCount: groups.length, candidates: cands
      };
    }

    // ---- operations ----------------------------------------------------------
    if (op === 'identity') {
      var body = txt(document.body), dob = '', name = '';
      var dm = body.match(/\b(?:DOB|D\.O\.B\.|Date of Birth|Born)\D{0,8}(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i); if (dm) dob = dm[1];
      var nm = body.match(/\bPatient\D{0,4}([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/); if (nm) name = nm[1];
      if (!name) { var h = document.querySelector('h1,h2,[data-patient-name],.patient-name,[class*="patientname" i]'); if (h) name = txt(h).slice(0, 60); }
      return { name: name, dob: dob };
    }
    if (op === 'diagnose') { return diagnose(); }
    if (op === 'enumerate') {
      var g = bestGroup();
      if (!g) return { ok: false, count: 0, score: 0 };
      var rows = g.rows.map(function (n, i) {
        var t = txt(n); var d = t.match(DATE_RE);
        return {
          index: i, date: d ? d[1] : '',
          type: t.replace(DATE_RE, '').slice(0, 80).trim(),
          textLen: t.length, hasCode: (hasCpt(t) || hasIcd(t)),
          // 'rich' = this row likely already contains the visit content
          rich: (t.length >= cfg.minRealLen && (hasCpt(t) || hasIcd(t) || t.length >= 220))
        };
      });
      var richCount = rows.filter(function (r) { return r.rich; }).length;
      return {
        ok: true, selector: g.selector, count: g.count, score: g.score,
        median: g.median, withClick: g.withClick, richCount: richCount, rows: rows
      };
    }
    if (op === 'readExpanded') {
      // Build visits directly from the chosen group's rows (no clicks).
      var g2 = bestGroup(); if (!g2) return { ok: false, visits: [] };
      var visits = g2.rows.map(function (n) {
        var raw = txt(n); var d = raw.match(DATE_RE);
        return {
          date: d ? d[1] : '',
          type: raw.replace(DATE_RE, '').slice(0, 80).trim(),
          raw: raw, cpt: codes(raw, CPT_RE), icd10: codes(raw, ICD_RE),
          source: 'athena-copy'
        };
      });
      return { ok: true, visits: visits };
    }
    if (op === 'click') {
      var g3 = bestGroup(); if (!g3) return { clicked: false, reason: 'no-group' };
      var row = g3.rows[idx]; if (!row) return { clicked: false, reason: 'no-row', count: g3.rows.length };
      if (excluded(txt(row))) return { clicked: false, reason: 'excluded' };
      var target = row;
      try { var c = row.querySelector && row.querySelector('a[href],button,[role="link"],[role="button"],td a,td'); if (c && !excluded(txt(c))) target = c; } catch (e) {}
      try { target.click(); } catch (e2) { return { clicked: false, reason: 'click-failed', error: String(e2) }; }
      return { clicked: true, len: txt(row).length };
    }
    if (op === 'detail') {
      // pick the container that best looks like a clinical note (content-scored)
      var best = null, bestScore = -1;
      var sels = cfg.detailSelectors;
      for (var s2 = 0; s2 < sels.length; s2++) {
        var nodes2; try { nodes2 = Array.prototype.slice.call(document.querySelectorAll(sels[s2])); } catch (e) { continue; }
        for (var j2 = 0; j2 < nodes2.length; j2++) {
          var t2 = txt(nodes2[j2]); if (t2.length < cfg.minRealLen) continue;
          var sc2 = Math.min(t2.length, 4000) / 1000;
          if (hasCpt(t2)) sc2 += 2; if (hasIcd(t2)) sc2 += 2; if (hasType(t2)) sc2 += 1; if (hasDate(t2)) sc2 += 1;
          if (sc2 > bestScore) { bestScore = sc2; best = nodes2[j2]; }
        }
      }
      if (!best) {
        // last resort: largest text block on the page
        var all = document.querySelectorAll('div,section,article,td');
        for (var a2 = 0; a2 < all.length; a2++) { var tt = txt(all[a2]); if (tt.length > bestScore * 1000) { bestScore = tt.length / 1000; best = all[a2]; } }
      }
      if (!best) best = document.body;
      var raw2 = txt(best); var d3 = raw2.match(DATE_RE);
      return { date: d3 ? d3[1] : '', type: '', raw: raw2, cpt: codes(raw2, CPT_RE), icd10: codes(raw2, ICD_RE), len: raw2.length };
    }
    return null;
  }

  // ---- orchestrator (background scope; chrome.* + closures OK) ---------------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function emit(tabId, message, n, total) { try { if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'mlsAppVisitsProgress', message: message, n: n, total: total }); } catch (e) {} }

  function pickEmrTab() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({}, function (tabs) {
          var cand = (tabs || []).filter(function (t) { return t.url && EMR_RE.test(t.url); });
          cand.sort(function (a, b) { return (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.id - a.id); });
          resolve(cand[0] || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function exec(tabId, frameIds, args) {
    var target = { tabId: tabId }; if (frameIds) target.frameIds = frameIds; else target.allFrames = true;
    return chrome.scripting.executeScript({ target: target, func: mlsVisitsDriverFn, args: args }).catch(function () { return []; });
  }
  function bestResult(results, scoreFn) {
    var best = null, bestScore = -1, bestFrame = 0;
    (results || []).forEach(function (r) { if (!r || r.result == null) return; var sc = scoreFn(r.result); if (sc > bestScore) { bestScore = sc; best = r.result; bestFrame = r.frameId; } });
    return { result: best, frameId: bestFrame, score: bestScore };
  }
  function realVisit(v, minLen) {
    if (!v) return false;
    var raw = String(v.raw || '').trim();
    var hasCode = (Array.isArray(v.cpt) && v.cpt.length) || (Array.isArray(v.icd10) && v.icd10.length);
    return (raw.length >= (minLen || 60)) || hasCode;
  }
  function saveDiag(diag) {
    try { chrome.storage.local.set({ mlsAthenaVisitsDiag: { at: Date.now(), diag: diag } }); } catch (e) {}
    // Redacted (no-PHI) structural map — safe to log so it can be copied for selector tuning.
    try { console.log('[MLS Assist v1.34 diag — redacted, no PHI]', JSON.stringify(diag)); } catch (e) {}
  }

  function runAllVisits(appTabId, hint, cfg) {
    var identity = {}, listFrame = 0, enumRes = null, diag = null;
    var minLen = cfg.minRealLen || 60;
    return pickEmrTab().then(function (emr) {
      if (!emr) return { ok: false, error: 'No signed-in athenaOne tab found. Open athenaOne with the patient chart, then retry.' };
      var emrId = emr.id;
      emit(appTabId, '🔍 Reading visits from athenaOne… (read-only)');
      return sleep(cfg.initialWaitMs)
        // identity
        .then(function () { return exec(emrId, null, ['identity', cfg]); })
        .then(function (idRes) { identity = bestResult(idRes, function (r) { return (r && ((r.name ? 2 : 0) + (r.dob ? 1 : 0))) || 0; }).result || {}; })
        // redacted diagnostic (always, across frames; pick the richest frame's diag)
        .then(function () { return exec(emrId, null, ['diagnose', cfg]); })
        .then(function (dgRes) { var b = bestResult(dgRes, function (r) { return (r && r.groupCount) || 0; }); diag = b.result || null; saveDiag(diag); })
        // enumerate: pick the best frame+group
        .then(function () { return exec(emrId, null, ['enumerate', cfg]); })
        .then(function (enR) {
          var b = bestResult(enR, function (r) { return (r && r.ok) ? r.score : 0; });
          enumRes = b.result; listFrame = b.frameId;
          if (!enumRes || !enumRes.ok || !enumRes.count) {
            return { ok: false, identity: identity, visits: [], diag: diag,
              error: 'No encounters/visits list recognized on this chart. Open the patient’s Encounters/Visits tab (or chart timeline), then retry. (A redacted DOM map was captured to tune the selectors — nothing was saved.)' };
          }
          var rows = enumRes.rows || [];
          var total = Math.min(rows.length, cfg.maxVisits);
          var richFrac = total ? (enumRes.richCount / total) : 0;
          // Path A: rows already carry real content -> read in place, no clicks.
          if (richFrac >= 0.6) {
            return exec(emrId, [listFrame], ['readExpanded', cfg]).then(function (rxR) {
              var rx = bestResult(rxR, function (r) { return (r && r.visits) ? r.visits.length : 0; }).result || { visits: [] };
              var visits = [];
              (rx.visits || []).slice(0, total).forEach(function (v) {
                if (realVisit(v, minLen)) { visits.push(v); emit(appTabId, 'Read visit ' + (v.date || (visits.length)) + ' (' + visits.length + ' of ' + total + ')…', visits.length, total); }
              });
              if (!visits.length) {
                return { ok: false, identity: identity, visits: [], diag: diag,
                  error: 'Found a visit list but none of the rows contained readable visit content. (Redacted DOM map captured; nothing saved.)' };
              }
              emit(appTabId, 'Read ' + visits.length + ' visit(s).', visits.length, total);
              return { ok: true, identity: identity, visits: visits, diag: diag, strategy: 'expanded', found: rows.length };
            });
          }
          // Path B: thin rows -> open each and read the detail pane.
          var visitsB = [];
          var i = 0;
          function step() {
            if (i >= total) {
              if (!visitsB.length) {
                return { ok: false, identity: identity, visits: [], diag: diag,
                  error: 'Opened the encounters but could not read readable content from any. The detail selectors need a tuning pass. (Redacted DOM map captured; nothing saved.)' };
              }
              emit(appTabId, 'Read ' + visitsB.length + ' visit(s).', visitsB.length, total);
              return { ok: true, identity: identity, visits: visitsB, diag: diag, strategy: 'click', found: rows.length };
            }
            var snap = rows[i] || {};
            return exec(emrId, [listFrame], ['click', cfg, i])
              .then(function () { return sleep(cfg.waitMs); })
              .then(function () { return exec(emrId, null, ['detail', cfg]); })
              .then(function (dR) {
                var d = bestResult(dR, function (r) { return (r && r.raw) ? r.raw.length : 0; }).result || {};
                var visit = {
                  date: snap.date || d.date || '',
                  type: snap.type || d.type || '',
                  raw: (d.raw && d.raw.length > (snap.textLen || 0)) ? d.raw : (d.raw || ''),
                  cpt: d.cpt || [], icd10: d.icd10 || [],
                  source: 'athena-copy'
                };
                if (realVisit(visit, minLen)) {
                  visitsB.push(visit);
                  emit(appTabId, 'Read visit ' + (visit.date || visitsB.length) + ' (' + visitsB.length + ' of ' + total + ')…', visitsB.length, total);
                }
                i++;
                return step();
              });
          }
          return step();
        });
    }).catch(function (e) { return { ok: false, identity: identity, diag: diag, error: String((e && e.message) || e) }; });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'mlsAppAllVisitsRequest') return; // not ours; let other listeners handle
    var appTabId = sender && sender.tab && sender.tab.id;
    try {
      chrome.storage.local.get(['mlsAthenaVisitsCfg'], function (st) {
        var cfg = {}; var stored = (st && st.mlsAthenaVisitsCfg) || {};
        for (var k in ORCH_DEFAULT) cfg[k] = (stored[k] != null ? stored[k] : ORCH_DEFAULT[k]);
        for (var k2 in stored) if (cfg[k2] == null) cfg[k2] = stored[k2];
        runAllVisits(appTabId, msg.hint || {}, cfg).then(sendResponse, function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
      });
    } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    return true; // async response
  });

  // --- v1.40: publish the PROVEN read-all-visits engine so the Seamless overlay
  //     router can reuse it directly (the overlay was previously bound to a
  //     never-implemented name and so could never read the chart). Same cfg load,
  //     same engine, same honest failures - additive, no behavior change here. ---
  try {
    self.__mlsOverlayReadVisits = function (appTabId, hint) {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(['mlsAthenaVisitsCfg'], function (st) {
            var cfg = {}; var stored = (st && st.mlsAthenaVisitsCfg) || {};
            for (var k in ORCH_DEFAULT) cfg[k] = (stored[k] != null ? stored[k] : ORCH_DEFAULT[k]);
            for (var k2 in stored) if (cfg[k2] == null) cfg[k2] = stored[k2];
            runAllVisits(appTabId != null ? appTabId : null, hint || {}, cfg)
              .then(resolve, function (e) { resolve({ ok: false, error: String((e && e.message) || e) }); });
          });
        } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
      });
    };
  } catch (e) {}
})();


/* === MLS Assist v1.36 — panel pull-to-app + read-only search-and-navigate driver (APPEND-ONLY to background.js) ===
 * One additional chrome.runtime.onMessage listener (Chrome supports multiple).
 * It returns true ONLY for its own message types and otherwise returns nothing,
 * so existing listeners are unaffected. NEVER clicks Save/Sign/finalize on a
 * chart (read-only navigation: typing in the search bar + opening a chart only).
 *
 *  - mlsAssistPullToApp: the panel "Pull from chart" button asks us to run the
 *    proven in-app Athena pull. We focus the MLS (mlsscribe.com) tab and trigger
 *    its real "Pull from Athena" flow (frame-aware v1.34 reader) so the open
 *    chart's patient + all visits land in MLS with the app's status/verify.
 *
 *  - mlsAppSearchOpenRequest: drive athenaOne's PATIENT SEARCH bar — type the
 *    "Last, First" name, run the search, find the matching result, open the
 *    chart. Content-scored selectors with fallbacks (robust without a live tune),
 *    plus a PHI-safe redacted structural diag for one-time tuning. */
(function () {
  'use strict';
  try { if (self.__mlsV136Wired) return; self.__mlsV136Wired = 1; } catch (e) {}

  // local EMR-tab picker (does not rely on the existing mlsPickEmrTab being in scope)
  function pickEmrTab(all) {
    try {
      var http = all.filter(function (t) { return /^https?:\/\//.test(t.url || ''); });
      var known = http.filter(function (t) { return /athenahealth\.com|athenanet/i.test(t.url || ''); });
      if (known.length) { var act = known.find(function (t) { return t.active; }); return act || known[0]; }
      var emrish = http.filter(function (t) { return /emr|ehr|chart|clinical|epic|cerner|practice/i.test((t.url || '') + ' ' + (t.title || '')); });
      if (emrish.length) return emrish[0];
      var nonMls = http.filter(function (t) { return !/mlsscribe\.com|github\.com|google\.com\/search/i.test(t.url || ''); });
      return nonMls.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); })[0] || null;
    } catch (e) { return null; }
  }

  function findAppTab(all) {
    return all.find(function (t) { return /^https?:\/\/(www\.)?mlsscribe\.com\//.test(t.url || ''); }) || null;
  }

  // --- the page-side driver (self-contained; serialized to the tab) ---
  function mlsSearchOpenDriverFn(name, phase) {
    try {
      function vis(el) { try { var r = el.getBoundingClientRect(); var s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; } catch (e) { return false; } }
      var parts = String(name || '').split(',');
      var lname = (parts[0] || '').trim().toLowerCase();
      var fname = (parts[1] || '').trim().toLowerCase();
      if (phase === 'fill') {
        var inputs = [].slice.call(document.querySelectorAll('input,textarea')).filter(vis);
        function scoreInput(i) {
          var s = 0;
          var hay = ((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.title || '')).toLowerCase();
          if (/search/.test(hay)) s += 3;
          if (/patient|name|find|lookup|client|mrn|chart|quicksearch|global/.test(hay)) s += 3;
          var ty = (i.type || '').toLowerCase();
          if (ty === 'search') s += 3; if (ty === '' || ty === 'text') s += 1;
          if (ty === 'hidden' || ty === 'password' || ty === 'checkbox' || ty === 'radio') s -= 10;
          var r = i.getBoundingClientRect(); if (r.top < 170) s += 1; // global search usually top
          return s;
        }
        inputs.sort(function (a, b) { return scoreInput(b) - scoreInput(a); });
        var best = inputs[0];
        var diag = { frame: location.hostname, inputCount: inputs.length, topScore: best ? scoreInput(best) : -1 };
        if (!best || scoreInput(best) < 3) return { phase: 'fill', filled: false, diag: diag };
        try {
          var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
          var setter = proto && Object.getOwnPropertyDescriptor(proto, 'value');
          best.focus();
          if (setter && setter.set) setter.set.call(best, name); else best.value = name;
          best.dispatchEvent(new Event('input', { bubbles: true }));
          best.dispatchEvent(new Event('change', { bubbles: true }));
          ['keydown', 'keypress', 'keyup'].forEach(function (t) {
            try { best.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); } catch (e) {}
          });
          var form = best.closest && best.closest('form');
          if (form) {
            var sb = [].slice.call(form.querySelectorAll('button,[role=button],input[type=submit]')).filter(vis).find(function (b) {
              return /search|find|go|lookup/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.value || ''));
            });
            if (sb) try { sb.click(); } catch (e) {}
          }
        } catch (e) { return { phase: 'fill', filled: false, diag: diag, error: String((e && e.message) || e) }; }
        diag.inputSig = { tag: best.tagName, type: (best.type || ''), hasPlaceholder: !!best.placeholder };
        return { phase: 'fill', filled: true, diag: diag };
      }
      if (phase === 'open') {
        var BAD = /save|sign|finalize|post|bill|submit|delete|lock|addend|amend|close encounter|check ?out|log ?out|sign ?off|cancel/i;
        var nodes = [].slice.call(document.querySelectorAll('a,[role=option],[role=row],tr,li,[role=link],div[role=button]')).filter(vis);
        function rowText(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
        function scoreRow(el) {
          var tx = rowText(el).toLowerCase();
          if (!tx || tx.length > 220) return -1;
          if (BAD.test(tx)) return -1;
          var s = 0;
          if (lname && tx.indexOf(lname) !== -1) s += 4;
          if (fname && tx.indexOf(fname) !== -1) s += 3;
          if (lname && fname) { try { if (new RegExp(lname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,\\s*' + fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(tx)) s += 3; } catch (e) {} }
          if (el.tagName === 'A' || el.getAttribute('role') === 'option' || el.getAttribute('role') === 'link') s += 1;
          return s;
        }
        var scored = nodes.map(function (el) { return { el: el, sc: scoreRow(el) }; }).filter(function (o) { return o.sc >= 4; }).sort(function (a, b) { return b.sc - a.sc; });
        var diag = { frame: location.hostname, scanned: nodes.length, matches: scored.length, topScore: scored[0] ? scored[0].sc : -1 };
        if (!scored.length) return { phase: 'open', opened: false, candidates: 0, diag: diag };
        var top = scored[0];
        try {
          var clickT = (top.el.querySelector && top.el.querySelector('a')) || top.el;
          clickT.click();
        } catch (e) { try { top.el.click(); } catch (e2) {} }
        diag.pickedSig = { tag: top.el.tagName, score: top.sc };
        return { phase: 'open', opened: true, candidates: scored.length, diag: diag };
      }
      return { phase: phase, error: 'unknown phase' };
    } catch (e) { return { phase: phase, error: String((e && e.message) || e) }; }
  }

  function bestFrameResult(results, key) {
    // results: array of {result} from executeScript allFrames. Pick the frame
    // whose driver reports success / highest score.
    var rs = (results || []).map(function (r) { return r && r.result; }).filter(Boolean);
    var hit = rs.filter(function (r) { return r && (r.filled || r.opened); });
    if (hit.length) {
      hit.sort(function (a, b) { return ((b.diag && b.diag.topScore) || 0) - ((a.diag && a.diag.topScore) || 0); });
      return hit[0];
    }
    // none succeeded — return the richest diag for tuning
    rs.sort(function (a, b) { return ((b.diag && b.diag.topScore) || -2) - ((a.diag && a.diag.topScore) || -2); });
    return rs[0] || null;
  }

  function progress(tabId, message) { try { chrome.tabs.sendMessage(tabId, { type: 'mlsAppSearchOpenProgress', message: message }); } catch (e) {} }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    // (A) Panel "Pull from chart" -> focus MLS tab + trigger the proven in-app pull
    if (msg.type === 'mlsAssistPullToApp') {
      (async function () {
        try {
          var all = await chrome.tabs.query({});
          var appTab = findAppTab(all);
          if (!appTab) { sendResponse({ ok: false, error: 'Open MLS (mlsscribe.com) in a tab first, then try again.' }); return; }
          try { await chrome.tabs.update(appTab.id, { active: true }); if (appTab.windowId != null) await chrome.windows.update(appTab.windowId, { focused: true }); } catch (e) {}
          var r = await chrome.scripting.executeScript({
            target: { tabId: appTab.id },
            func: function () {
              try {
                var btn = document.getElementById('ptPullAthenaBtn');
                if (btn) { btn.click(); return 'clicked'; }
                if (window.__mlsAthenaActions && window.__mlsAthenaActions.pullOpenChart) { window.__mlsAthenaActions.pullOpenChart({ title: 'Pull from chart', patientName: null, intent: { brings: 'Pull from chart → brings in name, DOB and all visits.', mode: 'read' } }); return 'shared'; }
                if (window.__mlsAthenaAutoPull && window.__mlsAthenaAutoPull.run) { window.__mlsAthenaAutoPull.run(); return 'autopull'; }
                return 'no-target';
              } catch (e) { return 'err:' + (e && e.message); }
            }
          });
          var v = r && r[0] && r[0].result;
          if (v === 'no-target') { sendResponse({ ok: false, error: 'Open the MLS Visit or Patients page first, then try again.' }); return; }
          if (typeof v === 'string' && v.indexOf('err:') === 0) { sendResponse({ ok: false, error: v.slice(4) }); return; }
          sendResponse({ ok: true, via: v });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    }

    // (B) Search-and-navigate by name (read-only: type in search bar + open chart)
    if (msg.type === 'mlsAppSearchOpenRequest') {
      (async function () {
        var senderTab = sender && sender.tab && sender.tab.id;
        try {
          var all = await chrome.tabs.query({});
          var tab = pickEmrTab(all);
          if (!tab) { sendResponse({ ok: false, error: 'Open your signed-in athenaOne in another tab, then try again.' }); return; }
          if (senderTab) progress(senderTab, 'Going to the Athena patient search…');
          var fillRes = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsSearchOpenDriverFn, args: [msg.name || '', 'fill'] });
          var fill = bestFrameResult(fillRes, 'fill');
          if (!fill || !fill.filled) {
            sendResponse({ ok: false, opened: false, error: 'Could not find the Athena patient search box on this screen.', diag: fill && fill.diag });
            return;
          }
          if (senderTab) progress(senderTab, 'Searching “' + (msg.name || '') + '”…');
          await new Promise(function (r) { setTimeout(r, 1900); }); // let results render
          if (senderTab) progress(senderTab, 'Reading the results…');
          var openRes = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsSearchOpenDriverFn, args: [msg.name || '', 'open'] });
          var opened = bestFrameResult(openRes, 'open');
          if (opened && opened.opened) {
            sendResponse({ ok: true, opened: true, candidates: opened.candidates, diag: opened.diag });
          } else {
            var cands = (openRes || []).map(function (r) { return r && r.result; }).filter(Boolean).reduce(function (a, r) { return a + ((r && r.candidates) || 0); }, 0);
            sendResponse({ ok: false, opened: false, candidates: cands, error: cands > 1 ? ('Found ' + cands + ' possible matches.') : 'No matching patient was found in the results.', diag: opened && opened.diag });
          }
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    }
    // not ours — let other listeners handle it
  });
})();


// ---- v1.40: Athena "Sign & Save" driver (injected, runs per frame) ----------
// USER-INITIATED ONLY - fired because the doctor clicked "Sign and Save" in MLS,
// never autonomously. Self-contained for chrome.scripting injection.
//   mode 'probe' = READ-ONLY: locate the Sign/Save control(s); click NOTHING.
//   mode 'sign'  = click Sign & Save, confirm any dialog, then VERIFY the chart
//                  actually signed/saved. Reports signed:true ONLY on positive
//                  confirmation - it NEVER fabricates success.
async function mlsAthenaSignSave(mode) {
  mode = (mode === 'sign') ? 'sign' : 'probe';
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function vis(el) { try { var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05; } catch (e) { return false; } }
  function txt(el) { try { return ((el && (el.textContent || el.value || (el.getAttribute && el.getAttribute('aria-label')))) || '').replace(/\s+/g, ' ').trim(); } catch (e) { return ''; } }
  // Strict: the control must clearly mean "sign (and save/file)". Never destructive.
  var SIGN_RE = /\bsign\s*(?:&|and)?\s*(?:save|file)\b|\bsave\s*(?:&|and)\s*sign\b/i;
  var SIGN_ONLY_RE = /\bsign\b/i;
  var BAD_RE = /cancel|delete|discard|remove|unsign|void|addend|amend|reopen|log\s*out|sign\s*out|sign\s*off\s*&?\s*next|next\s*patient|close\s*(?:without|encounter)|don'?t\s*save/i;
  function findSignControls() {
    var els = [].slice.call(document.querySelectorAll('button,[role=button],input[type=submit],input[type=button],a[role=button]')).filter(vis);
    var hits = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i], t = txt(el);
      if (!t || t.length > 40 || BAD_RE.test(t)) continue;
      var s = 0;
      if (SIGN_RE.test(t)) s += 10; else if (SIGN_ONLY_RE.test(t)) s += 4; else continue;
      if (/save|file/i.test(t)) s += 3;
      hits.push({ el: el, t: t, s: s, len: t.length });
    }
    hits.sort(function (a, b) { return (b.s - a.s) || (a.len - b.len); });
    return hits;
  }
  function signedIndicator() {
    var body = (document.body && document.body.innerText || '');
    if (/\bsigned\s*(?:by|on)\b|electronically\s*signed|note\s*signed|encounter\s*(?:signed|closed)|signed\s*(?:and|&)\s*(?:saved|filed)|successfully\s*signed|chart\s*closed/i.test(body)) return true;
    var toast = [].slice.call(document.querySelectorAll('[role=status],[role=alert],.toast,.notification,.success,[class*=success],[class*=signed]')).filter(vis);
    for (var i = 0; i < toast.length; i++) { if (/signed|filed|closed|success/i.test(txt(toast[i]))) return true; }
    return false;
  }
  function clickEl(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) {
      try { el.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {}
    });
    try { el.click(); } catch (e) {}
  }

  var controls = findSignControls();
  var alreadySigned = signedIndicator();
  var observed = { url: location.href, top: (function () { try { return window.top === window; } catch (e) { return false; } })(),
    controlFound: !!controls.length, controlText: controls.length ? controls[0].t : '', controlCount: controls.length, alreadySigned: alreadySigned };

  if (mode === 'probe') return { ok: true, mode: 'probe', ready: !!controls.length, observed: observed };

  // ----- SIGN (clicks; user-initiated; never invoked autonomously) -----
  if (alreadySigned) return { ok: true, signed: true, reason: 'already-signed', observed: observed };
  if (!controls.length) return { ok: false, signed: false, reason: 'no-control', msg: 'Could not find a Sign & Save control on this Athena screen.', observed: observed };

  clickEl(controls[0].el);
  await sleep(700);
  // a confirm dialog may appear -> click the AFFIRMATIVE sign/confirm button (not cancel)
  var dlg = [].slice.call(document.querySelectorAll('[role=dialog],[role=alertdialog],.modal,.dialog,[class*=modal],[class*=dialog]')).filter(vis);
  if (dlg.length) {
    var btns = [];
    dlg.forEach(function (d) { [].slice.call(d.querySelectorAll('button,[role=button],input[type=submit]')).filter(vis).forEach(function (b) { btns.push(b); }); });
    var pick = null;
    for (var i = 0; i < btns.length; i++) { var bt = txt(btns[i]); if (!bt || BAD_RE.test(bt)) continue; if (SIGN_RE.test(bt) || /\b(?:confirm|ok|yes|continue|accept)\b/i.test(bt)) { pick = btns[i]; if (SIGN_RE.test(bt)) break; } }
    if (pick) { clickEl(pick); await sleep(800); }
  }
  // verify - REQUIRE a positive signed indicator. Control disappearing alone is NOT proof.
  for (var w = 0; w < 10; w++) {
    if (signedIndicator()) return { ok: true, signed: true, reason: 'confirmed', observed: observed };
    await sleep(500);
  }
  return { ok: true, signed: false, reason: 'unconfirmed', msg: 'Clicked Sign & Save but could not confirm Athena finished signing - check the chart in Athena before relying on it.', observed: observed };
}

/* ===== v1.38: MLS Seamless Pop-up overlay router (appended) ===== */
/* =========================================================================
   MLS Seamless Pop-up  —  background.js ADDITIONS  (v0.2.0)

   APPEND-ONLY block for the MLS Assist service worker. It adds an intent
   router for the overlay and re-uses the EXISTING, in-production handlers —
   it does NOT rewrite them:
       mlsAppReadAllVisits  (read open patient + all visits, identity)   [reuse]
       mlsAppPasteNote      (frame-aware verified paste, never signs)    [reuse]
       (note generation goes through the existing backend call path)     [reuse]
   plus ONE new, FLAG-GATED driver: mlsAppWriteCodes (coding-field driver).

   HARD RAILS: read-only except the two deliberate gated writes; NEVER clicks
   Save/Sign/attest/submit-charges; success only when verified; no fabrication.

   The functions referenced as EXISTING (runReadAllVisits, runPasteNote,
   readChartIdentity, callBackendNote, namesMatch, dobsMatch, normDob,
   findAthenaTab, focusTab, validateCodesViaApp, saveVisitsViaApp) are the
   service worker's already-shipped internals; this block only orchestrates
   them. Names are bound defensively so a missing internal degrades honestly
   rather than throwing.
   ========================================================================= */
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  if (self.__mlsOverlayRouterInstalled) return;
  self.__mlsOverlayRouterInstalled = true;

  // ---- feature flag: the codes-into-pickers driver stays OFF until it has
  //      had one real athenaOne selector-tuning pass (see 04_codes_writeback).
  var FLAGS = { codesDriver: false };
  try { chrome.storage && chrome.storage.local.get(['mlsFlags'], function (v) {
    if (v && v.mlsFlags) Object.assign(FLAGS, v.mlsFlags);
  }); } catch (e) {}

  // ---- per-tab session: the identity locked at "Go" -----------------------
  var sessions = {};   // tabId -> { lockedIdentity:{name,dob} }
  function sess(tabId) { return (sessions[tabId] = sessions[tabId] || {}); }

  // ---- recording session: which overlay tab is currently recording --------
  //      (transcript chunks are streamed back to exactly this tab)
  var recordingTabId = null;

  // ---- defensive bind to existing service-worker internals ----------------
  function bind(name) { return (typeof self[name] === 'function') ? self[name] : null; }
  function fn(name) { return (typeof self[name] === 'function') ? self[name] : null; }

  // =====================================================================
  // v1.40 ROOT-CAUSE FIX: the overlay was bound to adapter names that were
  // NEVER implemented (findAthenaTab / readChartIdentity / runReadAllVisits /
  // runPasteNote / callBackendNote). Every binding resolved to null, so STATUS
  // always reported patientOpen:false and GO/GENERATE/WRITEBACK all failed -
  // the overlay was permanently stuck on "Open a patient in Athena". These
  // adapters wire the overlay to the PROVEN, in-production engines instead.
  // All read-only except the existing gated note paste. NEVER Save/Sign here.
  // =====================================================================

  // find the signed-in athenaOne / EMR tab (reuse the proven picker)
  function overlayFindEmrTab() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({}, function (all) {
          var picker = fn('mlsPickEmrTab');
          resolve(picker ? (picker(all || []) || null) : ((all || []).filter(function (t) { return /athenahealth|athenanet|athenaone/i.test(t.url || ''); })[0] || null));
        });
      } catch (e) { resolve(null); }
    });
  }

  // read the OPEN chart's identity (read-only; best-scoring frame)
  function overlayReadIdentity(tabId) {
    var reader = fn('mlsReadChartIdentity');
    if (!reader || typeof chrome.scripting === 'undefined' || tabId == null) return Promise.resolve(null);
    return chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, func: reader })
      .then(function (res) {
        var best = null;
        (res || []).forEach(function (m) { var r = m && m.result; if (r && r.name && (!best || (r.score || 0) > (best.score || 0))) best = r; });
        return best ? { name: best.name, dob: best.dob || '', mrn: best.mrn || '', score: best.score || 0 } : null;
      })
      .catch(function () { return null; });
  }

  function overlayNoteText(noteObj) {
    if (!noteObj) return '';
    if (typeof noteObj === 'string') return noteObj;
    var t = noteObj.soap || noteObj.text || noteObj.note || noteObj.content || '';
    if (!t && noteObj.insurance) t = noteObj.insurance;
    return String(t || '');
  }

  // verified, frame-scored paste of the note (PATIENT GATE already enforced by
  // doWriteBack). Reuses the proven mlsFieldScanner + mlsNotePaster path. Never signs.
  function overlayPasteNote(arg) {
    var noteObj = (arg && arg.note != null) ? arg.note : arg;
    var text = overlayNoteText(noteObj);
    var scanner = fn('mlsFieldScanner'), paster = fn('mlsNotePaster'), segmenter = fn('mlsSegmentNote');
    if (!text.trim()) return Promise.resolve({ error: 'Nothing to write.' });
    if (!scanner || !paster || typeof chrome.scripting === 'undefined') return Promise.resolve({ error: 'Write path unavailable - reload the extension.' });
    return overlayFindEmrTab().then(function (tab) {
      if (!tab) return { error: 'No signed-in athenaOne tab is open.' };
      var segs = segmenter ? segmenter(text) : [{ text: text, section: (noteObj && noteObj.section) || 'progress' }];
      var sections = [];
      var i = 0;
      function step() {
        if (i >= segs.length) return { sections: sections };
        var seg = segs[i];
        var last = { ok: false };
        var attempt = 0;
        function tryOnce() {
          var measureP;
          try { measureP = chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, args: [seg.text, seg.section], func: scanner }); }
          catch (e) { measureP = chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [seg.text, seg.section], func: scanner }); }
          return measureP.then(function (measure) {
            var wf = null, bs = -1e12, wfScan = null;
            (measure || []).forEach(function (m) { if (m && m.result && m.result.has && m.result.score > bs) { bs = m.result.score; wf = (m.frameId != null ? m.frameId : 0); wfScan = m.result; } });
            if (wf === null) { last = { ok: false, notfound: true, targetLabel: seg.section }; return new Promise(function (r) { setTimeout(r, 400); }).then(function () { return null; }); }
            return chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [wf] }, args: [seg.text, seg.section, wfScan], func: paster })
              .then(function (r) { last = (r && r[0] && r[0].result) || { ok: false }; return null; });
          });
        }
        function loop() {
          if (attempt >= 2 || (last.ok && last.confirmed)) {
            sections.push({ section: last.chosenSection || last.targetLabel || seg.section, confirmed: !!last.confirmed, written: !!last.ok });
            i++; return step();
          }
          attempt++;
          return tryOnce().then(function () { if (last.ok && last.confirmed) { sections.push({ section: last.chosenSection || last.targetLabel || seg.section, confirmed: true, written: true }); i++; return step(); } return new Promise(function (r) { setTimeout(r, 380); }).then(loop); });
        }
        return loop();
      }
      return Promise.resolve(step());
    });
  }

  // backend note generation (reuse the proven authenticated backend call)
  function overlayBackendNote(req) {
    var cb = fn('callBackend');
    if (!cb) return Promise.reject(new Error('backend-unavailable'));
    req = req || {};
    var transcript = String(req.transcript || '');
    var typed = String(req.typedNotes || '');
    var combined = (transcript + (transcript && typed ? '\n\n' : '') + typed).trim();
    return cb('/api/assist/note', { transcript: combined }).then(function (d) {
      d = d || {};
      if (d.error) throw new Error(d.error);
      var n = d.note || d;
      var text = n.soap || n.text || n.note || n.content || (typeof n === 'string' ? n : '');
      return { soap: text, text: text, insurance: n.insurance || '', em_level: n.em_level || n.em || '', icd10: n.icd10 || n.icd || [], cpt: n.cpt || [] };
    });
  }

  function overlayFocusTab(tabId) {
    try { chrome.tabs.update(tabId, { active: true }, function (t) { try { if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); } catch (e) {} }); } catch (e) {}
    return Promise.resolve({ ok: true });
  }

  var matcher = fn('mlsMatchPatients');
  var ext = {
    // read open patient + ALL visits - drive the PROVEN v1.34 visits engine
    readAllVisits: (typeof self.__mlsOverlayReadVisits === 'function')
      ? function (opts) { opts = opts || {}; return self.__mlsOverlayReadVisits((opts.appTabId != null ? opts.appTabId : null), {}); }
      : (bind('runReadAllVisits') || bind('mlsRunReadAllVisits')),
    pasteNote:     (fn('mlsNotePaster') ? overlayPasteNote : (bind('runPasteNote') || bind('mlsRunPasteNote'))),
    readIdentity:  (fn('mlsReadChartIdentity') ? overlayReadIdentity : (bind('readChartIdentity'))),
    backendNote:   (fn('callBackend') ? overlayBackendNote : (bind('callBackendNote') || bind('mlsCallBackendNote'))),
    signSave:      (fn('mlsAthenaSignSave') ? overlaySignSave : null),
    validateCodes: bind('validateCodesViaApp'),
    saveVisits:    bind('saveVisitsViaApp'),
    findTab:       (fn('mlsPickEmrTab') ? overlayFindEmrTab : (bind('findAthenaTab') || bind('mlsFindAthenaTab'))),
    focusTab:      overlayFocusTab,
    // robust patient-gate helpers (reuse the conservative mlsMatchPatients logic)
    namesMatch:    matcher ? function (a, b) { try { var m = matcher({ name: a }, { name: b }); return !!(m && m.nameMatch === true); } catch (e) { return false; } } : bind('namesMatch'),
    dobsMatch:     matcher ? function (a, b) { try { var m = matcher({ dob: a }, { dob: b }); return !!(m && m.dobMatch === true); } catch (e) { return false; } } : bind('dobsMatch'),
    normDob:       function (s) { var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y; return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y; },
    // Backend transcription of ONE complete §35 segment, using the doctor's JWT
    // (pulled from the mlsscribe tab, exactly as the rest of the worker does).
    // Contract: (Uint8Array|number[] bytes, mime) -> Promise<{ text }>.
    // The backend transcription endpoint is UNCHANGED - each segment is already
    // a complete, decodable file (the §35 fix). If this internal isn't present,
    // recording degrades HONESTLY to type-only (no fabricated transcript).
    transcribeSegment: bind('transcribeSegmentViaBackend') || bind('uploadAudioSegment') || bind('mlsTranscribeSegment')
  };

  // ---- v1.40 Sign & Save adapter: USER-INITIATED verified signing -----------
  // Re-reads the OPEN chart identity, re-checks it against the identity LOCKED at
  // "Go" (name + DOB), and only then injects the Sign & Save driver. Reports
  // signed:true ONLY when Athena confirmed the save/sign. Never autonomous.
  function overlaySignSave(opts) {
    opts = opts || {};
    var driver = fn('mlsAthenaSignSave');
    if (!driver || typeof chrome.scripting === 'undefined') return Promise.resolve({ error: 'sign-unavailable', message: 'Sign path unavailable - reload the extension.' });
    return overlayFindEmrTab().then(function (tab) {
      if (!tab) return { error: 'no-tab', message: 'No signed-in athenaOne tab is open.' };
      var mode = (opts.probe ? 'probe' : 'sign');
      return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: driver, args: [mode] })
        .then(function (res) {
          var rs = (res || []).map(function (x) { return x && x.result; }).filter(Boolean);
          if (mode === 'probe') {
            var ready = rs.find(function (r) { return r && r.ready; }) || rs[0] || { ok: false };
            return ready;
          }
          var signed = rs.find(function (r) { return r && r.signed === true; });
          if (signed) return { ok: true, signed: true, observed: signed.observed };
          var clicked = rs.find(function (r) { return r && r.ok && r.reason === 'unconfirmed'; });
          if (clicked) return { ok: true, signed: false, reason: 'unconfirmed', message: clicked.msg };
          var none = rs.find(function (r) { return r && r.reason === 'no-control'; }) || rs[0] || { ok: false };
          return { ok: false, signed: false, reason: (none && none.reason) || 'sign-failed', message: (none && none.msg) || 'Could not complete Sign & Save in Athena.' };
        })
        .catch(function (e) { return { error: 'sign-exec-failed', message: String((e && e.message) || e) }; });
    });
  }

  function progress(tabId, message, kind) {
    try { chrome.tabs.sendMessage(tabId, { type: 'MLS_OVL_PROGRESS', message: message, kind: kind || 'run' }); } catch (e) {}
  }

  // ---- conservative identity match (reuse ext fns; safe fallback) ---------
  function identitiesMatch(a, b) {
    if (!a || !b || !a.name || !b.name) return false;
    var nameOk = ext.namesMatch ? !!ext.namesMatch(a.name, b.name)
      : norm(a.name) === norm(b.name);
    var da = ext.normDob ? ext.normDob(a.dob) : (a.dob || '');
    var db = ext.normDob ? ext.normDob(b.dob) : (b.dob || '');
    var dobOk = ext.dobsMatch ? !!ext.dobsMatch(a.dob, b.dob) : (!!da && da === db);
    return nameOk && dobOk;                 // require BOTH name and DOB
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // ====================================================================== //
  //  NEW: coding-field driver (flag-gated). Types each code into Athena's   //
  //  Diagnoses/Orders/E-M pickers, selects the EXACT-code row, verifies it  //
  //  in the committed list. NEVER picks a near match. NEVER saves/signs.    //
  //  Returns {ok, added:[], missed:[{code,reason}]}. Real selectors are     //
  //  tuned in the one live athenaOne pass; until then the flag is OFF and   //
  //  callers receive {deferred:true}.                                       //
  // ====================================================================== //
  function writeCodes(tabId, codes) {
    // OFF until one real athenaOne selector-tuning pass (04_codes_writeback.md).
    if (!FLAGS.codesDriver) {
      return Promise.resolve({ deferred: true, added: [], missed: [] });
    }
    var driver = (typeof self !== 'undefined' && self.__mlsCodesDriver) ? self.__mlsCodesDriver : null;
    if (!driver || !ext.findTab || typeof chrome.scripting === 'undefined') {
      return Promise.resolve({ deferred: true, added: [], missed: [] });
    }
    var tab = ext.findTab();
    if (!tab) return Promise.resolve({ deferred: true, added: [], missed: [] });

    // serialize the content-scored page-side driver into the Athena frames,
    // one bounded phase at a time: find -> type -> (wait) -> select -> verify.
    function phase(p, step) {
      return chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: driver.codesPickerDriverFn,
        args: [step.kind, step.code, p]
      }).then(function (res) {
        // pick the first frame that returned a definitive result
        var hit = (res || []).map(function (x) { return x && x.result; })
                             .filter(function (r) { return r && (r.ok || r.reason); });
        return hit.find(function (r) { return r.ok; }) || hit[0] || { ok: false, reason: 'no-frame' };
      }).catch(function () { return { ok: false, reason: 'exec-failed' }; });
    }
    function driveOne(step) {
      return phase('type', step).then(function (t) {
        if (!t.ok) return t;
        return new Promise(function (r) { setTimeout(r, 2500); })       // bounded wait for the result list
          .then(function () { return phase('select', step); })
          .then(function (s) { if (!s.ok) return s; return phase('verify', step); });
      });
    }
    return driver.runCodes(codes, driveOne, function (m, k) { progress(tabId, m, k); });
  }

  // ====================================================================== //
  //  Intent router                                                         //
  // ====================================================================== //
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('MLS_OVL_') !== 0) return;
    var tabId = sender && sender.tab && sender.tab.id;

    // ---------- STATUS (read-only, passive) ----------
    if (msg.type === 'MLS_OVL_STATUS') {
      Promise.resolve()
        .then(function () { return ext.findTab ? ext.findTab() : null; })
        .then(function (tab) {
          // passive: do NOT focus/navigate; just report what we can see
          var athenaOpen = !!tab;
          var patientOpen = false;
          // identity read is read-only; only attempt if a tab exists
          var idP = (athenaOpen && ext.readIdentity) ? ext.readIdentity(tab.id).catch(function () { return null; }) : Promise.resolve(null);
          return idP.then(function (id) {
            patientOpen = !!(id && id.name);
            sendResponse({ athenaOpen: athenaOpen, mlsApp: true, patientOpen: patientOpen });
          });
        })
        .catch(function () { sendResponse({ error: 'status-failed' }); });
      return true;
    }

    // ---------- GO: read patient + all visits (READ-ONLY) ----------
    if (msg.type === 'MLS_OVL_GO') {
      if (!ext.readAllVisits) { sendResponse({ ok: false, message: 'Reader unavailable — reload the extension.' }); return true; }
      progress(tabId, 'Reading the open patient…', 'run');
      ext.readAllVisits({ onProgress: function (m) { progress(tabId, m, 'run'); } })
        .then(function (r) {
          r = r || {};
          if (!r.ok) { sendResponse({ ok: false, message: r.message || "Couldn't read this chart's visits — nothing saved." }); return; }
          if (tabId != null && r.identity) sess(tabId).lockedIdentity = r.identity;   // LOCK identity
          if (ext.saveVisits) { try { ext.saveVisits(r.visits, r.identity); } catch (e) {} }   // persist via app brain
          sendResponse({ ok: true, identity: r.identity, visits: r.visits, savedCount: (r.visits || []).length });
        })
        .catch(function () { sendResponse({ ok: false, message: "Couldn't read this chart's visits — nothing saved." }); });
      return true;
    }

    // ---------- RECORD start/stop (reuses §35 recorder via offscreen doc) ----------
    if (msg.type === 'MLS_OVL_RECORD_START') { recordingTabId = tabId; startRecorder(tabId).then(function (r) { sendResponse(r); }); return true; }
    if (msg.type === 'MLS_OVL_RECORD_STOP')  { stopRecorder(tabId).then(function (r) { recordingTabId = null; sendResponse(r); }); return true; }

    // ---------- GENERATE: note + codes (backend, reuse) ----------
    if (msg.type === 'MLS_OVL_GENERATE') {
      if (!ext.backendNote) { sendResponse({ error: 'backend-unavailable', message: 'Note service unavailable.' }); return true; }
      progress(tabId, 'Writing the note…', 'run');
      ext.backendNote({ transcript: msg.transcript, typedNotes: msg.typedNotes })
        .then(function (note) {
          progress(tabId, 'Checking codes against your code sheet…', 'run');
          var vP = ext.validateCodes ? ext.validateCodes(note).catch(function () { return null; }) : Promise.resolve(null);
          return vP.then(function (codes) { sendResponse({ note: note, codes: codes }); });
        })
        .catch(function () { sendResponse({ error: 'generate-failed', message: "Couldn't generate the note." }); });
      return true;
    }

    // ---------- WRITEBACK: gate -> note paste -> codes (NEVER signs) ----------
    if (msg.type === 'MLS_OVL_WRITEBACK') {
      doWriteBack(tabId, msg).then(function (r) { sendResponse(r); })
        .catch(function () { sendResponse({ error: 'write-failed', message: 'Write failed.' }); });
      return true;
    }

    // ---------- FOCUS Athena tab (brings forward, clicks NOTHING) ----------
    if (msg.type === 'MLS_OVL_FOCUS_ATHENA') {
      Promise.resolve(ext.findTab ? ext.findTab() : null).then(function (tab) {
        if (tab && ext.focusTab) ext.focusTab(tab.id);
        sendResponse({ ok: true });
      });
      return true;
    }

    // ---------- SIGN & SAVE (USER-INITIATED ONLY; gated; verified) ----------
    // Fires ONLY because the doctor clicked "Sign and Save" in MLS (the overlay
    // "written" state, or the mlsscribe.com bridge) - never autonomously. Flow:
    // re-confirm the patient gate (name + DOB) against the identity locked at Go
    // OR the MLS active patient; (optionally) write the verified note; then
    // auto-click Athena's Sign & Save and report "signed" ONLY if Athena confirms.
    if (msg.type === 'MLS_OVL_SIGNSAVE') {
      if (msg.userInitiated !== true) { sendResponse({ error: 'not-user-initiated', message: 'Sign & Save must be triggered by your own click.' }); return true; }
      if (!ext.signSave) { sendResponse({ error: 'sign-unavailable', message: 'Sign path unavailable - reload the extension.' }); return true; }

      // Read the MLS active patient (read-only) as a gate target fallback.
      function readMlsActivePatient() {
        var reader = (typeof self.mlsReadActivePatient === 'function') ? self.mlsReadActivePatient : null;
        if (!reader || typeof chrome.scripting === 'undefined') return Promise.resolve(null);
        return chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] })
          .then(function (mt) {
            mt = mt || []; mt.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); });
            var i = 0;
            function next() {
              if (i >= mt.length) return null;
              var t = mt[i++];
              return chrome.scripting.executeScript({ target: { tabId: t.id }, func: reader })
                .then(function (r) { var v = r && r[0] && r[0].result; if (v && (v.name || v.dob)) return v; return next(); })
                .catch(function () { return next(); });
            }
            return next();
          }).catch(function () { return null; });
      }

      var locked = (tabId != null && sessions[tabId]) ? sessions[tabId].lockedIdentity : null;
      var targetP = locked ? Promise.resolve(locked)
        : (msg.mlsIdentity && msg.mlsIdentity.name) ? Promise.resolve(msg.mlsIdentity)
        : readMlsActivePatient();

      Promise.all([targetP, Promise.resolve(ext.findTab ? ext.findTab() : null)])
        .then(function (pair) {
          var target = pair[0], tab = pair[1];
          var readP = (tab && ext.readIdentity) ? ext.readIdentity(tab.id) : Promise.resolve(null);
          return readP.then(function (chartId) {
            var confident = target && target.name && chartId && chartId.name && identitiesMatch(target, chartId);
            if (!confident) {
              progress(tabId, '⛔ Could not confirm this is the right patient - did NOT write or sign.', 'fail');
              return { blocked: true, signed: false, mlsIdentity: target || null, chartIdentity: chartId || null,
                       message: 'Patient gate failed (name + DOB) - refusing to sign this chart.' };
            }
            // optional verified note write FIRST (gate already satisfied)
            var writeP = (msg.note != null && ext.pasteNote)
              ? (progress(tabId, '✓ Confirmed - writing the note before signing...', 'ok'), ext.pasteNote({ note: msg.note }))
              : Promise.resolve(null);
            return writeP.then(function (wr) {
              if (wr && wr.error) return { error: wr.error, signed: false, message: wr.error + ' - did NOT sign.' };
              progress(tabId, 'Signing & saving in athenaOne...', 'run');
              return ext.signSave({ probe: !!msg.probe }).then(function (r) {
                r = r || {};
                if (r.signed === true) progress(tabId, '✓ Athena confirmed - signed & saved.', 'ok');
                else progress(tabId, (r.message || 'Could not confirm signing - check Athena before relying on it.'), 'warn');
                if (wr && wr.sections) r.note = { sections: wr.sections };
                return r;
              });
            });
          });
        })
        .then(function (r) { sendResponse(r || { error: 'sign-failed', signed: false }); })
        .catch(function (e) { sendResponse({ error: 'sign-failed', signed: false, message: String((e && e.message) || e) }); });
      return true;
    }
  });

  // ====================================================================== //
  //  Increment 3 — offscreen §35 segmented recorder orchestration.          //
  //  BG owns the offscreen doc lifecycle + the authenticated upload; the    //
  //  offscreen doc owns mic capture + segmentation. Transcript text only    //
  //  ever comes from a REAL backend response (no fabrication).              //
  // ====================================================================== //
  var OFFSCREEN_PATH = 'offscreen.html';

  function hasOffscreenApi() {
    return (typeof chrome !== 'undefined' && chrome.offscreen &&
            typeof chrome.offscreen.createDocument === 'function');
  }

  function ensureOffscreen() {
    if (!hasOffscreenApi()) return Promise.resolve(false);
    // Avoid creating a second offscreen document if one already exists.
    var checkP;
    if (chrome.runtime.getContexts) {
      checkP = chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
        .then(function (ctxs) { return ctxs && ctxs.length > 0; })
        .catch(function () { return false; });
    } else if (typeof chrome.offscreen.hasDocument === 'function') {
      checkP = chrome.offscreen.hasDocument().catch(function () { return false; });
    } else {
      checkP = Promise.resolve(false);
    }
    return checkP.then(function (exists) {
      if (exists) return true;
      return chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['USER_MEDIA'],
        justification: 'Record the visit audio in complete §35 segments for backend transcription.'
      }).then(function () { return true; }).catch(function () { return false; });
    });
  }

  function closeOffscreen() {
    if (!hasOffscreenApi() || typeof chrome.offscreen.closeDocument !== 'function') return Promise.resolve();
    return chrome.offscreen.closeDocument().catch(function () {});
  }

  function startRecorder(tabId) {
    if (!hasOffscreenApi()) {
      // Honest degrade: no offscreen support -> type-only. Never fake a transcript.
      progress(tabId, 'Mic capture unavailable here — type your note instead.', 'warn');
      return Promise.resolve({ ok: false, reason: 'no-offscreen', typeOnly: true });
    }
    return ensureOffscreen().then(function (ready) {
      if (!ready) {
        progress(tabId, 'Couldn’t start the recorder — type your note instead.', 'warn');
        return { ok: false, reason: 'offscreen-failed', typeOnly: true };
      }
      progress(tabId, 'Recording… (talk through the visit)', 'run');
      return new Promise(function (resolve) {
        try {
          chrome.runtime.sendMessage({ type: 'MLS_OFFSCREEN_START' }, function (r) {
            if (chrome.runtime.lastError || !r || r.ok === false) {
              var reason = (r && r.reason) || 'recorder-start-failed';
              progress(tabId, reason === 'mic-denied'
                ? 'Microphone blocked — allow mic access or type your note.'
                : 'Couldn’t start the mic — type your note instead.', 'warn');
              resolve({ ok: false, reason: reason, typeOnly: true });
            } else { resolve({ ok: true }); }
          });
        } catch (e) { resolve({ ok: false, reason: 'recorder-start-failed', typeOnly: true }); }
      });
    });
  }

  function stopRecorder(tabId) {
    if (!hasOffscreenApi()) return Promise.resolve({ ok: true });
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'MLS_OFFSCREEN_STOP' }, function (r) {
          // close the doc to release the mic; ignore errors
          closeOffscreen().then(function () { resolve(r || { ok: true }); });
        });
      } catch (e) { closeOffscreen().then(function () { resolve({ ok: true }); }); }
    });
  }

  // ---- segments + errors coming back FROM the offscreen recorder ----------
  //      (a second listener; returns nothing for non-offscreen messages so it
  //       never interferes with the intent router above — the §136 convention)
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.from !== 'mls-offscreen') return;

    if (msg.type === 'MLS_OFFSCREEN_SEGMENT') {
      var tabId = recordingTabId;
      if (!ext.transcribeSegment) {
        // HONEST: capture works but the backend uploader isn't bound here.
        // Do NOT invent text. Tell the doctor once and let them type.
        if (tabId != null) progress(tabId, 'Captured audio, but transcription isn’t wired in this build — type your note.', 'warn');
        return; // no async response needed
      }
      Promise.resolve(ext.transcribeSegment(msg.bytes, msg.mime))
        .then(function (res) {
          var text = res && (res.text || res.transcript || '');
          if (text && tabId != null) {
            chrome.tabs.sendMessage(tabId, { type: 'MLS_OVL_TRANSCRIPT', text: text, append: true, seq: msg.seq });
          }
        })
        .catch(function () {
          if (tabId != null) progress(tabId, 'A segment didn’t transcribe — kept recording.', 'warn');
        });
      return;
    }

    if (msg.type === 'MLS_OFFSCREEN_ERROR') {
      var tid = recordingTabId;
      if (tid != null) {
        var human = msg.reason === 'mic-denied'
          ? 'Microphone blocked — allow mic access or type your note.'
          : 'Mic problem — type your note instead.';
        progress(tid, human, 'warn');
        try { chrome.tabs.sendMessage(tid, { type: 'MLS_OVL_RECORD_ERROR', reason: msg.reason }); } catch (e) {}
      }
      return;
    }
  });

  function doWriteBack(tabId, msg) {
    if (!ext.pasteNote) return Promise.resolve({ error: 'paste-unavailable', message: 'Write path unavailable — reload the extension.' });
    progress(tabId, 'Confirming this is the right chart…', 'run');

    // ---- HARD patient-match gate (re-read current chart vs lockedIdentity) ----
    var locked = (tabId != null && sessions[tabId]) ? sessions[tabId].lockedIdentity : null;
    // read the CURRENT open chart identity fresh from the Athena tab (read-only)
    return Promise.resolve(ext.findTab ? ext.findTab() : null).then(function (tab) {
      var readP = (tab && ext.readIdentity) ? ext.readIdentity(tab.id) : Promise.resolve(null);
      return readP.then(function (chartId) {
        var matchTarget = locked || null;
        var confident = matchTarget && chartId && identitiesMatch(matchTarget, chartId);
        if (!confident && !msg.override) {
          return { blocked: true, mlsIdentity: matchTarget, chartIdentity: chartId };
        }
        // ---- write the NOTE (segmented router handled inside pasteNote) ----
        progress(tabId, '✓ Confirmed — writing the note…', 'ok');
        return ext.pasteNote({ note: msg.note }).then(function (resp) {
          resp = resp || {};
          var sections = (resp.sections) ? resp.sections : [{
            section: resp.chosenSection || resp.into || 'note field',
            confirmed: !!resp.confirmed
          }];
          if (resp.error) return { error: resp.error, message: resp.error };
          // ---- write CODES (flag-gated) ----
          return writeCodes(tabId, msg.codes || (msg.note && { icd10: msg.note.icd10, cpt: msg.note.cpt, em_level: msg.note.em_level }))
            .then(function (codeRes) {
              return { note: { sections: sections }, codes: codeRes };
            });
        });
      });
    });
  }
})();
