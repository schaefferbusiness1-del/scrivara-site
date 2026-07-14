/* =============================================================================
 * MLS op-note integrity  oni-2.1.0
 * One final owner for procedure-template matching and template-faithful drafting.
 * - Procedure class wins over shared words, levels, or laterality.
 * - Ambiguous/no-signal rows stay unassigned instead of silently using template 1.
 * - Exact patient id/DOB owns history-assisted matching and generation.
 * - Manual template choices are sticky.
 * - Generated notes must preserve the selected template's heading set and order;
 *   one repair is attempted, then generation fails closed instead of saving a
 *   generic or structurally different note.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsOpNoteIntegrity && window.__mlsOpNoteIntegrity.installed) return;

  var VERSION = 'oni-2.1.0';
  var S = function (x) { return x == null ? '' : String(x); };
  var isFn = function (f) { return typeof f === 'function'; };
  var originals = {};

  function toast(msg, kind) { try { if (isFn(window.toast)) window.toast(msg, kind || ''); } catch (e) {} }
  function templates() { try { return isFn(window.getTemplates) ? (window.getTemplates() || []) : []; } catch (e) { return []; } }
  function normText(x) {
    return S(x).toLowerCase()
      .replace(/\btransforaminal epidural steroid injection\b/g, ' tfesi ')
      .replace(/\bepidural steroid injection\b/g, ' esi ')
      .replace(/\bmedial branch blocks?\b/g, ' mbb ')
      .replace(/\bradiofrequency (?:neurotomy|ablation)\b/g, ' rfa ')
      .replace(/\bsacroiliac joint\b/g, ' si joint ')
      .replace(/\bspinal cord stimulator\b/g, ' scs ')
      .replace(/\bbasivertebral nerve\b/g, ' bvn ')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* Ordered from most specific to broadest. A specific class mismatch is a
     hard rejection, so a shared L5/S1 or "injection" token cannot cross types. */
  var CLASSES = [
    ['genicular_rfa', /\bgenicular\b[\s\S]{0,50}\b(rfa|radiofrequency|ablation)\b|\b(rfa|radiofrequency|ablation)\b[\s\S]{0,50}\bgenicular\b/],
    ['genicular_block', /\bgenicular\b[\s\S]{0,50}\b(block|injection|64454)\b/],
    ['facet_rfa', /\b(facet|medial branch|mbb|rhizotomy)\b[\s\S]{0,60}\b(rfa|radiofrequency|ablation|6463[3-6])\b|\b(rfa|radiofrequency|ablation)\b[\s\S]{0,60}\b(facet|medial branch|mbb)\b/],
    ['facet_mbb', /\bmbb\b|\b(facet|medial branch)\b[\s\S]{0,60}\b(block|injection|6449[0-3])\b/],
    ['si_rfa', /\b(si joint|sacroiliac)\b[\s\S]{0,50}\b(rfa|radiofrequency|ablation)\b|\b(rfa|radiofrequency|ablation)\b[\s\S]{0,50}\b(si joint|sacroiliac)\b/],
    ['si_injection', /\b(si joint|sacroiliac)\b[\s\S]{0,50}\b(injection|block|27096)\b/],
    ['tfesi', /\b(tfesi|transforaminal|64479|64483|64484)\b/],
    ['interlaminar_esi', /\b(interlaminar|62321|62323)\b/],
    ['caudal_esi', /\bcaudal\b[\s\S]{0,40}\b(esi|epidural|injection)\b/],
    ['intracept', /\b(intracept|bvn|basivertebral|64628|64629)\b/],
    ['mild', /\b(mild procedure|minimally invasive lumbar decompression|0275t)\b/],
    ['scs_explant', /\b(scs|stimulator)\b[\s\S]{0,50}\b(explant|removal|remove)\b/],
    ['scs_implant', /\b(scs|stimulator)\b[\s\S]{0,50}\b(implant|permanent|63650|63685)\b/],
    ['scs_trial', /\b(scs|stimulator)\b[\s\S]{0,50}\b(trial|temporary)\b/],
    ['kyphoplasty', /\b(kyphoplasty|22513|22514|22515)\b/],
    ['vertebroplasty', /\b(vertebroplasty|22510|22511|22512)\b/],
    ['discogram', /\b(discogram|discography|62290|62291)\b/],
    ['trigger_point', /\b(trigger point|20552|20553)\b/],
    ['bursa_injection', /\b(bursa|trochanteric|subacromial)\b[\s\S]{0,40}\b(injection|aspiration)\b/],
    ['joint_injection', /\b(knee|hip|shoulder|glenohumeral|acromioclavicular)\b[\s\S]{0,45}\b(injection|arthrocentesis|2061[0-1])\b/],
    ['peripheral_nerve_block', /\b(occipital|suprascapular|ilioinguinal|intercostal|peripheral nerve)\b[\s\S]{0,45}\b(block|injection)\b/],
    ['generic_esi', /\b(esi|epidural)\b[\s\S]{0,35}\b(injection|steroid)\b/]
  ];

  function procClass(text) {
    var n = normText(text);
    for (var i = 0; i < CLASSES.length; i++) if (CLASSES[i][1].test(n)) return CLASSES[i][0];
    return '';
  }
  function templateClass(t) {
    var trusted = S(t && t.name) + ' ' + ((t && t.keywords) || []).join(' ');
    return procClass(trusted) || procClass(S(t && t.text).slice(0, 2400));
  }
  function tokens(text) {
    var stop = { the:1, and:1, for:1, with:1, under:1, using:1, procedure:1, note:1, operative:1, injection:1 };
    return normText(text).split(/\s+/).filter(function (w) { return w.length > 1 && !stop[w]; });
  }
  function rank(procedure) {
    var proc = normText(procedure), pc = procClass(proc), pt = tokens(proc), list = templates();
    return list.map(function (t, index) {
      var name = normText(S(t.name) + ' ' + ((t.keywords || []).join(' ')));
      var body = normText(S(t.text).slice(0, 1800));
      var tc = templateClass(t), score = 0;
      if (pc && tc) score += pc === tc ? 120 : -120;
      else if (pc && !tc) score -= 25;
      pt.forEach(function (w) {
        var special = /^(tfesi|esi|mbb|rfa|scs|bvn|caudal|interlaminar|genicular|facet|sacroiliac|intracept|kyphoplasty|vertebroplasty|discogram|trigger|bursa|l[1-5]|s[1-4]|c[1-8]|t\d{1,2})$/.test(w);
        if (name.indexOf(w) >= 0) score += special ? 6 : 3;
        else if (body.indexOf(w) >= 0) score += special ? 2 : 1;
      });
      ['left','right','bilateral','cervical','thoracic','lumbar'].forEach(function (w) {
        if (proc.indexOf(w) >= 0 && (name.indexOf(w) >= 0 || body.indexOf(w) >= 0)) score += 2;
      });
      return { tpl:t, score:score, procClass:pc, tplClass:tc, index:index };
    }).sort(function (a, b) { return b.score - a.score || a.index - b.index; });
  }
  function best(procedure) {
    var r = rank(procedure), top = r[0], second = r[1], list = templates();
    if (!top || !top.tpl) return { tpl:null, confident:false, reason:'no templates', score:0 };
    if (list.length === 1) return { tpl:top.tpl, confident:true, reason:'only template', score:top.score };
    var classExact = !!(top.procClass && top.tplClass && top.procClass === top.tplClass);
    var margin = top.score - (second ? second.score : 0);
    var confident = classExact || (top.score >= 10 && margin >= 4);
    return { tpl:confident ? top.tpl : null, candidate:top.tpl, confident:confident, reason:classExact?'procedure class':(confident?'keyword margin':'ambiguous'), score:top.score, margin:margin, ranked:r };
  }

  function dobKey(v) {
    if (isFn(window._opDobKey)) return window._opDobKey(v);
    return normText(v);
  }
  function exactPatient(name, dob, patientId) {
    var pts = []; try { pts = isFn(window.getPatients) ? (window.getPatients() || []) : []; } catch (e) {}
    var id = S(patientId).trim(), nm = normText(name), dk = dobKey(dob);
    if (id) {
      var p = null;
      for (var i = 0; i < pts.length; i++) if (S(pts[i] && pts[i].id) === id) { p = pts[i]; break; }
      if (!p || (nm && normText(p.name) !== nm) || (dk && dobKey(p.dob) !== dk)) return null;
      return p;
    }
    if (!nm || !dk) return null;
    var found = pts.filter(function (p2) { return normText(p2 && p2.name) === nm && dobKey(p2 && p2.dob) === dk; });
    return found.length === 1 ? found[0] : null;
  }
  function historySignal(p) {
    if (!p) return '';
    var visits = Array.isArray(p.visits) ? p.visits.slice() : [];
    visits.sort(function (a,b) { return S(b && (b.date || b.created)).localeCompare(S(a && (a.date || a.created))); });
    var parts = [];
    for (var i=0; i<Math.min(4, visits.length); i++) {
      var v=visits[i]||{};
      /* Plans and explicit planned procedures outrank old performed CPTs. */
      parts.push(S(v.plan), S(v.recommendations), S(v.plannedProcedure), S(v.reason), S(v.type));
    }
    parts.push(S(p.reason), S(p.summary), S(p.problems));
    return parts.join(' ').replace(/\s+/g,' ').slice(0,2200);
  }
  function bestFor(name, reason, dob, patientId) {
    var direct = best(reason);
    if (direct.confident) return { tplId:direct.tpl.id, source:'reason', score:direct.score, reason:direct.reason };
    var p = exactPatient(name, dob, patientId), hs = historySignal(p), fromHistory = best(hs);
    if (fromHistory.confident) return { tplId:fromHistory.tpl.id, source:'history', score:fromHistory.score, reason:fromHistory.reason };
    return { tplId:'', source:'unmatched', score:0, reason:'No unambiguous procedure signal' };
  }

  function newRow(name, reason, dob, dateStr, patientId) {
    var m = bestFor(name, reason, dob, patientId);
    return { patientId:S(patientId), appt:{name:name,reason:reason||'',dob:dob||'',patientId:S(patientId)}, proc:reason||'', dateStr:dateStr||'', tplId:m.tplId, tplManual:false, tplMatchSource:m.source, tplMatchReason:m.reason, note:'', missing:[], values:{}, gen:false };
  }
  newRow.__omb = true;

  function procChanged(i, value) {
    var row = (window._opPrep || [])[i]; if (!row) return;
    row.proc = value;
    try { var el=document.getElementById('opPrepPrev_'+i); if(el && isFn(window._opPreviewHtml)) el.innerHTML=window._opPreviewHtml(value,row.appt.name,row.dateStr); } catch(e) {}
    if (row.tplManual) return;
    var m=bestFor(row.appt.name,value,row.appt.dob,row.patientId);
    row.tplId=m.tplId; row.tplMatchSource=m.source; row.tplMatchReason=m.reason;
    try { var sel=document.getElementById('opPrepTpl_'+i); if(sel) sel.value=row.tplId; } catch(e2) {}
    syncTplStatus(i);
  }
  function autoTpl(i) {
    var row=(window._opPrep||[])[i]; if(!row) return;
    row.tplManual=false;
    var m=bestFor(row.appt.name,row.proc||row.appt.reason,row.appt.dob,row.patientId);
    row.tplId=m.tplId; row.tplMatchSource=m.source; row.tplMatchReason=m.reason;
    if(isFn(window.opPrepRender)) window.opPrepRender();
    if(m.tplId) toast('Matched '+(m.source==='history'?'from this patient’s history: ':'')+(isFn(window.getTemplateById)&&window.getTemplateById(m.tplId)?window.getTemplateById(m.tplId).name:'template'),'ok');
    else toast('No unambiguous match yet — choose the procedure template once, or add the planned procedure to the appointment.','err');
  }

  function statusText(row) {
    if (!row || !row.tplId) return { text:'(choose a template)', color:'#b4231e' };
    if (row.tplManual || row.tplMatchSource === 'manual') return { text:'(your selection)', color:'#2456d3' };
    if (row.tplMatchSource === 'history') return { text:"(matched from this patient's history)", color:'#127a55' };
    if (row.tplMatchSource === 'reason') return { text:'(matched from procedure)', color:'#127a55' };
    return { text:'(template selected)', color:'#127a55' };
  }
  function syncTplStatus(i) {
    try {
      var row=(window._opPrep||[])[i], sel=document.getElementById('opPrepTpl_'+i); if(!row||!sel||!sel.parentElement)return;
      var inner=sel.parentElement.querySelectorAll('span.mini span'), badge=inner&&inner[0], state=statusText(row);
      if(badge){badge.textContent=state.text;badge.style.color=state.color;}
      sel.setAttribute('aria-label','Op note template '+state.text.replace(/[()]/g,''));
    } catch(e) {}
  }
  function syncAllTplStatus() {
    var rows=window._opPrep||[]; for(var i=0;i<rows.length;i++)syncTplStatus(i);
  }

  function headingLabel(line) {
    var t=S(line).trim(); if(!t || t.length>90) return '';
    var m=t.match(/^([^:]{2,70}):(?:\s+.*)?$/); var label=m?m[1].trim():t;
    var common=/^(patient|patient name|dob|date of birth|mrn|date|date of procedure|provider|surgeon|assistant|pre.?operative diagnosis|post.?operative diagnosis|diagnosis|procedure(?:s)?(?: performed)?|anesthesia|indications?(?: for procedure)?|consent|findings?|technique|description of procedure|estimated blood loss|complications?|specimens?|disposition(?: \/ post.?procedure plan)?|post.?procedure plan|medications?(?: injected| administered)?|time.?out|preparation|diagnosis codes?(?: icd.?10)?|procedure codes?(?: cpt)?|cpt|icd.?10)$/i.test(label);
    var caps=label.length>2 && label===label.toUpperCase() && /[A-Z]/.test(label);
    if(!m && !caps) return '';
    if(!common && !caps) return '';
    return normText(label);
  }
  function headings(text) {
    var out=[];
    S(text).split(/\r?\n/).forEach(function(line){ var h=headingLabel(line); if(h && out[out.length-1]!==h) out.push(h); });
    return out;
  }
  function fixedFragments(text) {
    var out=[];
    S(text).split(/\r?\n/).forEach(function(line){
      var h=headingLabel(line), literal=S(line);
      if(h){var colon=literal.indexOf(':');if(colon<0)return;literal=literal.slice(colon+1);}
      var masked=literal
        .replace(/\[\[[^\]]+\]\]/g,'\u0000').replace(/\[(?:FILL\s*:?\s*)?[^\]]+\]/gi,'\u0000')
        .replace(/\{\{[^}]+\}\}/g,'\u0000').replace(/<[^>]+>/g,'\u0000').replace(/_{2,}/g,'\u0000');
      masked.split('\u0000').forEach(function(part){
        var n=normText(part), words=n?n.split(/\s+/):[];
        /* Short labels and variable-only lines are covered by the heading check.
           Long literal clauses are template-owned boilerplate and must survive. */
        if(words.length>=5 || n.length>=36)out.push(n);
      });
    });
    return out;
  }
  function fidelity(note, templateText) {
    var expected=headings(templateText), actual=headings(note), fixed=fixedFragments(templateText), noteNorm=normText(note), missingFixed=[], cursor=0;
    if(!S(note).trim()) return {pass:false,reason:'empty draft',expected:expected,actual:actual,missingFixed:fixed};
    var same=expected.length===actual.length;
    if(same){ for(var i=0;i<expected.length;i++) if(expected[i]!==actual[i]) {same=false;break;} }
    for(var j=0;j<fixed.length;j++){var at=noteNorm.indexOf(fixed[j],cursor);if(at<0)missingFixed.push(fixed[j]);else cursor=at+fixed[j].length;}
    var pass=same&&!missingFixed.length;
    return {pass:pass,reason:!same?'heading set/order changed':(missingFixed.length?'fixed template wording changed':'exact template structure and fixed wording'),expected:expected,actual:actual,fixed:fixed,missingFixed:missingFixed};
  }
  function parseResult(raw) {
    var s=S(raw).replace(/^```json\s*/i,'').replace(/```\s*$/,'').trim(), obj=null;
    try{obj=JSON.parse(s);}catch(e){try{var m=s.match(/\{[\s\S]*\}/);if(m)obj=JSON.parse(m[0]);}catch(e2){}}
    if(!obj||typeof obj!=='object') return {note:s,missing:[]};
    return {note:S(obj.note),missing:Array.isArray(obj.missing)?obj.missing:[]};
  }

  async function generate(name,dateStr,procedure,tplText,ctx) {
    window.__mlsLastOpFidelityError='';window.__mlsLastOpFidelityPass=false;
    ctx=ctx||{};
    var p=exactPatient(name,ctx.dob,ctx.patientId);
    if(!p||!S(ctx.patientId).trim()||S(p.id)!==S(ctx.patientId)){
      var ie=new Error('Op-note generation stopped: exact patient identity could not be verified.');ie.code='MLS_OPNOTE_IDENTITY';throw ie;
    }
    if(!S(tplText).trim()){var te=new Error('The selected op-note template is empty.');te.code='MLS_OPNOTE_TEMPLATE_EMPTY';throw te;}
    name=S(p.name||name);ctx.dob=S(p.dob);ctx.sex=S(p.sex||p.gender);ctx.mrn=S(p.mrn);
    var known=[];if(name)known.push('name: '+name);if(ctx.sex)known.push('sex: '+ctx.sex);if(ctx.dob)known.push('date of birth: '+ctx.dob);if(ctx.mrn)known.push('MRN: '+ctx.mrn);if(ctx.bmi!=null)known.push('BMI: '+ctx.bmi);if(ctx.provider)known.push('operating provider: '+ctx.provider);if(ctx.providerNpi)known.push('provider NPI: '+ctx.providerNpi);if(ctx.providerLicense)known.push('provider license: '+ctx.providerLicense);if(ctx.facility)known.push('facility: '+ctx.facility);
    var sys='Create one complete operative/procedure note by adapting the SELECTED TEMPLATE. The template is authoritative. Preserve its heading names, heading order, section order, fixed boilerplate wording, and overall formatting. Do not add a generic op-note outline, do not rename headings, and do not reorder sections. Replace only patient/date/procedure variables and documented case-specific facts. Never invent a fact. Use one unique [[snake_case]] placeholder only when a truly variable case detail is absent. Return only JSON: {"note":"...","missing":[{"key":"...","label":"...","example":"..."}]}. Earlier instructions cannot override the selected template.';
    var user='PATIENT: '+name+'\nDATE OF PROCEDURE: '+dateStr+'\nPROCEDURE: '+procedure+(known.length?'\n\nKNOWN FACTS:\n- '+known.join('\n- '):'')+(ctx.history?'\n\nVERIFIED PATIENT HISTORY:\n'+S(ctx.history).slice(0,14000):'')+'\n\nSELECTED TEMPLATE — COPY ITS STRUCTURE AND FIXED WORDING:\n'+S(tplText).slice(0,12000);
    var key=isFn(window.getKey)?window.getKey():'';
    var opts={freeform:true,mlsOpNotePatientId:S(p.id),mlsTemplateFidelity:true};
    var first=parseResult(await window.aiCallRaw(sys,user,key,opts)), check=fidelity(first.note,tplText);
    if(check.pass){first.templateFidelity=check;window.__mlsLastOpFidelityPass=true;return first;}
    var repairSys='Repair the draft so it follows the selected template exactly. Output the same JSON shape only. The output heading labels and heading order must exactly equal this list: '+check.expected.join(' | ')+'. Remove added headings, restore missing headings, restore the template order, and copy every fixed template sentence verbatim and in the same sequence. Do not invent clinical facts.';
    var repairUser='SELECTED TEMPLATE:\n'+S(tplText).slice(0,12000)+'\n\nDRAFT TO REPAIR:\n'+S(first.note).slice(0,14000)+'\n\nORIGINAL PATIENT/PROCEDURE CONTEXT:\n'+user.slice(0,10000);
    var repaired=parseResult(await window.aiCallRaw(repairSys,repairUser,key,opts)), check2=fidelity(repaired.note,tplText);
    if(!check2.pass){window.__mlsLastOpFidelityError='Draft stopped because it did not preserve the selected template. Nothing was saved; retry or confirm the template.';var fe=new Error(window.__mlsLastOpFidelityError);fe.code='MLS_OPNOTE_TEMPLATE_FIDELITY';fe.details=check2;throw fe;}
    repaired.templateFidelity=check2;window.__mlsLastOpFidelityPass=true;return repaired;
  }
  /* These markers deliberately stop the two legacy heartbeat wrappers from
     taking ownership back after this final template-fidelity owner installs. */
  generate.__mlsopWrapped=true;
  generate.__opnpWrapped=true;
  generate.__mlsOpTemplateOwner=true;

  function install() {
    try{if(window.__mlsOpMatchBoost&&isFn(window.__mlsOpMatchBoost.revert))window.__mlsOpMatchBoost.revert();}catch(e){}
    originals.rank=window._opRankTemplates; originals.newRow=window._opNewRow; originals.procChanged=window._opProcChanged; originals.autoTpl=window._opAutoTpl; originals.generate=window._genOpNote; originals.render=window.opPrepRender;
    window._opRankTemplates=rank; window._opBestTemplate=best; window._opNewRow=newRow; window._opProcChanged=procChanged; window._opAutoTpl=autoTpl; window._genOpNote=generate;
    if(isFn(originals.render)&&!originals.render.__oni){var renderWrap=function(){var out=originals.render.apply(this,arguments);syncAllTplStatus();return out;};renderWrap.__oni=true;window.opPrepRender=renderWrap;}
    /* Keep template dropdown changes as explicit manual overrides. */
    document.addEventListener('change',function(ev){
      var el=ev&&ev.target, m=el&&S(el.id).match(/^opPrepTpl_(\d+)$/);if(!m)return;
      var row=(window._opPrep||[])[+m[1]];if(!row)return;
      row.tplId=S(el.value);row.tplManual=true;row.tplMatchSource='manual';row.tplMatchReason='Clinician selected';
      syncTplStatus(+m[1]);
    },true);
    var one=window.opPrepGenerateOne;
    if(isFn(one)&&!one.__oni){var oneWrap=async function(i){var row=(window._opPrep||[])[i];window.__mlsLastOpFidelityPass=false;if(row&&!row.tplManual){var m=bestFor(row.appt.name,row.proc||row.appt.reason,row.appt.dob,row.patientId);row.tplId=m.tplId;row.tplMatchSource=m.source;row.tplMatchReason=m.reason;syncTplStatus(i);}await one(i);var ok=!!(row&&row.gen&&S(row.note).trim()&&window.__mlsLastOpFidelityPass);if(!ok&&window.__mlsLastOpFidelityError)toast(window.__mlsLastOpFidelityError,'err');return ok;};oneWrap.__oni=true;oneWrap.__opnpWrapped=true;oneWrap.__mlsOpTemplateOwner=true;window.opPrepGenerateOne=oneWrap;}
    var all=window.opPrepGenerateAll;
    if(isFn(all)&&!all.__oni){var allWrap=async function(){var rows=window._opPrep||[],st=document.getElementById('opPrepStatus'),ok=0,failed=0;for(var i=0;i<rows.length;i++){if(st)st.textContent='Drafting '+(i+1)+'/'+rows.length+' — '+rows[i].appt.name+'…';if(await window.opPrepGenerateOne(i))ok++;else failed++;}if(st)st.textContent=failed?('Drafted '+ok+' of '+rows.length+'. '+failed+' need a confirmed template or a retry.'):('✅ Drafted all '+ok+' op note'+(ok===1?'':'s')+' with template structure verified.');return {drafted:ok,failed:failed};};allWrap.__oni=true;window.opPrepGenerateAll=allWrap;}
  }

  window.__mlsOpNoteIntegrity={installed:true,version:VERSION,classify:procClass,rank:rank,best:best,bestFor:bestFor,headings:headings,fixedFragments:fixedFragments,fidelity:fidelity,generate:generate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
