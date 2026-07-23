/* =============================================================================
 * MLS op-note integrity  oni-2.10.0
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

  var VERSION = 'oni-2.10.0';
  var S = function (x) { return x == null ? '' : String(x); };
  var isFn = function (f) { return typeof f === 'function'; };
  var originals = {};
  var generationByKey={},generationByPatient={};
  var GENERATION_STAGES=['Confirming procedure','Loading validated template','Applying provider defaults','Applying facility defaults','Drafting procedure section','Drafting findings','Checking side and level','Checking required fields','Running final consistency check','Note ready'];

  function shortHash(value){var h=2166136261,s=S(value);for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
  function requestedTemplateId(ctx){return S(ctx&&(ctx.templateId||ctx.tplId||ctx.selectedTemplateId)).trim();}
  function generationKey(dateStr,procedure,tplText,ctx){
    var pid=S(ctx&&ctx.patientId).trim(),tid=requestedTemplateId(ctx);
    return ['patient:'+(pid||'unverified'),'dob:'+dobKey(ctx&&ctx.dob),'date:'+S(dateStr).trim(),'procedure:'+normText(procedure),'provider:'+normText(ctx&&(ctx.providerId||ctx.provider)),'facility:'+normText(ctx&&(ctx.facilityId||ctx.facility)),'template:'+(tid||('text-'+shortHash(tplText))),'body:'+shortHash(tplText)].join('|');
  }
  function generationPatientKey(name,ctx){var pid=S(ctx&&ctx.patientId).trim();return pid?('patient:'+pid):('unverified:'+normText(name)+'|dob:'+dobKey(ctx&&ctx.dob));}
  function generationStage(ctx,stage,operation){
    var h=ctx&&ctx.__mlsProgressHandle;if(!h)return;
    var i=GENERATION_STAGES.indexOf(stage),patch={operation:operation||stage,current:i>=0?i+1:0,total:GENERATION_STAGES.length};
    try{h.stage(stage,patch);}catch(e){}
  }

  function toast(msg, kind) { try { if (isFn(window.toast)) window.toast(msg, kind || ''); } catch (e) {} }
  function templates() { try { return isFn(window.getTemplates) ? (window.getTemplates() || []) : []; } catch (e) { return []; } }
  function normText(x) {
    return S(x).toLowerCase()
      /* oni-2.6.2: Athena schedule-reason ABBREVIATIONS — "L SI joint inj P"
         must classify as an SI injection, "B/L L3, L4MB & L5 DR B" as MBBs.
         Expanded BEFORE phrase mapping so the class guard can fire and a
         cross-procedure template gets rejected instead of silently used. */
      .replace(/\bb\s*\/\s*l\b/g, ' bilateral ')
      .replace(/\binjs?\b/g, ' injection ')
      .replace(/\b([lcts]\d{1,2})\s*mbs?\b/g, ' $1 medial branch block ')
      .replace(/\bmbs\b/g, ' medial branch blocks ')
      .replace(/\bdr\s*b\b/g, ' dorsal ramus block ')
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
    ['generic_esi', /\besi\b|\bepidural\b[\s\S]{0,35}\b(injection|steroid)\b/]
  ];

  /* NEGATION: "no procedure performed", "without injection", "denies epidural"
     is not procedure evidence — the old matchers scored "performed" and the
     procedure noun as POSITIVE signal. Remove the negated clause (to the next
     punctuation) before classification/scoring. */
  function stripNegated(text) {
    return String(text == null ? '' : text).replace(
      /\b(?:no|not|without|denies|denied|negative for|none)\b[^.;\n]{0,80}?\b(?:procedures?|injections?|blocks?|ablation|rfa|esi|tfesi|epidural|surgery|stimulator|kyphoplasty|vertebroplasty|discogra\w+|performed)\b[^.;\n]*/gi, ' ');
  }
  function statesNoProcedure(text) {
    return /\bno\s+procedures?\s+(?:was\s+|were\s+)?performed\b|\bprocedures?\s+(?:was\s+|were\s+)?not\s+performed\b|\bno\s+procedure\s+today\b/i.test(String(text == null ? '' : text));
  }
  function procClass(text) {
    var n = normText(stripNegated(text));
    for (var i = 0; i < CLASSES.length; i++) if (CLASSES[i][1].test(n)) return CLASSES[i][0];
    return '';
  }

  /* Clinical identity is not one fuzzy string. Parse each requested fact into
     its own field so a common template can never silently turn Left L2 into
     bilateral S1, change region, or swap an approach. */
  function procedureEvidence(text) {
    /* oni-2.9.0 (live 2026-07-23): the heading list was too narrow — a valid
       draft expressing its levels under "LEVEL(S) TREATED:", "TARGET LEVELS:",
       "SITE:", "OPERATION PERFORMED:" etc. read as levels:[] and the final
       consistency check failed an honest note with "levels, levelCount".
       Recognize every procedure-DESCRIBING heading (history/indication
       headings stay excluded so prior-surgery levels never leak in). */
    var raw=S(text), lines=raw.split(/\r?\n/), picked=[];
    var HEAD=/^(?:(?:operative\s+)?procedure(?:s)?(?:\s+performed)?|operation(?:s)?(?:\s+performed)?|(?:name|title)\s+of\s+(?:procedure|operation)|laterality(?:\s+and\s+levels?)?|side|levels?(?:\s+(?:treated|injected|addressed|targeted))?|target(?:\s+levels?)?|sites?(?:\s+and\s+levels?)?|interspaces?|approach)\s*:/i;
    for(var i=0;i<lines.length;i++){
      var line=S(lines[i]).trim(); if(!line)continue;
      if(i<2&&/\b(?:operative|procedure|injection|block|ablation|tfesi|esi|rfa|stimulator|intracept)\b/i.test(line))picked.push(line);
      else if(HEAD.test(line))picked.push(line);
    }
    return (picked.length?picked.join(' '):raw.slice(0,1600)).slice(0,3000);
  }
  function sideOf(text) {
    var raw=S(text), n=raw.toLowerCase();
    var bilateral=/\bbilateral\b|\bb\s*\/\s*l\b|\bboth\s+sides?\b/.test(n);
    var left=/\bleft\b/.test(n)||/(^|[\s(:,;\-])l(?=\s+(?:[clts]\s*\d|si\b|sacroiliac\b|knee\b|hip\b|shoulder\b|genicular\b))/i.test(raw);
    var right=/\bright\b/.test(n)||/(^|[\s(:,;\-])r(?=\s+(?:[clts]\s*\d|si\b|sacroiliac\b|knee\b|hip\b|shoulder\b|genicular\b))/i.test(raw);
    if(bilateral||(left&&right))return 'bilateral';
    return left?'left':(right?'right':'');
  }
  function levelsOf(text) {
    /* oni-2.9.0: slash notation ("L4/5", "L4/L5") is a routine clinical short
       form and must parse exactly like the hyphen range. */
    var raw=S(text).toUpperCase().replace(/[–—]/g,'-'), seen={}, out=[];
    function add(prefix,num){num=Number(num);if(!/^[CLTS]$/.test(prefix)||num<1||num>12)return;var level=prefix+num;if(!seen[level]){seen[level]=1;out.push(level);}}
    var range=/\b([CLTS])\s*(\d{1,2})\s*[-\/]\s*(?:([CLTS])\s*)?(\d{1,2})\b/g,m;
    while((m=range.exec(raw))){var p1=m[1],p2=m[3]||p1,a=Number(m[2]),b=Number(m[4]);if(p1===p2&&a<=b&&b-a<=6){for(var x=a;x<=b;x++)add(p1,x);}else{add(p1,a);add(p2,b);}}
    var one=/\b([CLTS])\s*(\d{1,2})\b/g;
    while((m=one.exec(raw)))add(m[1],m[2]);
    var order={C:0,T:1,L:2,S:3};
    out.sort(function(a,b){return order[a.charAt(0)]-order[b.charAt(0)]||Number(a.slice(1))-Number(b.slice(1));});
    return out;
  }
  function regionOf(text,levels) {
    var n=normText(text), flags={}; levels=levels||levelsOf(text);
    if(/\bcervical\b/.test(n))flags.cervical=1;
    if(/\bthoracic\b/.test(n))flags.thoracic=1;
    if(/\b(lumbar|lumbo sacral|lumbosacral)\b/.test(n))flags.lumbar=1;
    if(/\b(sacral|sacroiliac|si joint|caudal)\b/.test(n))flags.sacral=1;
    if(/\b(genicular|knee)\b/.test(n))flags.knee=1;
    levels.forEach(function(l){var p=l.charAt(0);if(p==='C')flags.cervical=1;else if(p==='T')flags.thoracic=1;else if(p==='L')flags.lumbar=1;else if(p==='S')flags.sacral=1;});
    if(flags.lumbar&&flags.sacral)return 'lumbosacral';
    var names=['cervical','thoracic','lumbar','sacral','knee'].filter(function(k){return flags[k];});
    return names.length===1?names[0]:(names.length?names.join('+'):'');
  }
  function approachOf(text) {
    var n=normText(text);
    if(/\b(tfesi|transforaminal)\b/.test(n))return 'transforaminal';
    if(/\binterlaminar\b/.test(n))return 'interlaminar';
    if(/\bcaudal\b/.test(n))return 'caudal';
    return '';
  }
  function procedureFacts(text) {
    var evidence=procedureEvidence(text), levels=levelsOf(evidence);
    return {procedureType:procClass(evidence),region:regionOf(evidence,levels),side:sideOf(evidence),levels:levels,levelCount:levels.length,approach:approachOf(evidence),evidence:evidence};
  }
  function sameRegion(a,b){
    if(!a||!b)return true;
    if(a===b)return true;
    if(a==='lumbosacral'&&(b==='lumbar'||b==='sacral'))return true;
    if(b==='lumbosacral'&&(a==='lumbar'||a==='sacral'))return true;
    return false;
  }
  function sameLevels(a,b){a=(a||[]).slice().sort();b=(b||[]).slice().sort();return a.length===b.length&&a.every(function(v,i){return v===b[i];});}
  function compareFacts(requested,actual,requirePresent,fields) {
    fields=fields||['procedureType','region','side','levels','levelCount','approach'];var errors=[];
    function show(v){return Array.isArray(v)?(v.join(', ')||'none'):S(v||'none');}
    function check(field,label,eq){var want=requested[field],got=actual[field],has=Array.isArray(want)?want.length:!!want;if(!has)return;if(requirePresent&&!(Array.isArray(got)?got.length:got)){errors.push({field:field,code:'missing_'+field,message:'Draft did not clearly preserve requested '+label+' (requested: '+show(want)+'; found none in the procedure section).'});return;}if((Array.isArray(got)?got.length:got)&&!eq(want,got))errors.push({field:field,code:'mismatch_'+field,message:'Requested '+label+' conflicts with the draft ('+show(want)+' vs '+show(got)+').'});}
    if(fields.indexOf('procedureType')>=0)check('procedureType','procedure type',function(a,b){return a===b;});
    if(fields.indexOf('region')>=0)check('region','anatomical region',sameRegion);
    if(fields.indexOf('side')>=0)check('side','side',function(a,b){return a===b;});
    if(fields.indexOf('levels')>=0)check('levels','exact level(s)',sameLevels);
    if(fields.indexOf('levelCount')>=0&&requested.levelCount)check('levelCount','number of levels',function(a,b){return Number(a)===Number(b);});
    if(fields.indexOf('approach')>=0)check('approach','approach',function(a,b){return a===b;});
    return errors;
  }
  function scopeValue(v) {
    if(v&&typeof v==='object')return S(v.id||v.providerId||v.facilityId||v.name||v.label).trim();
    return S(v).trim();
  }
  function templateScopeErrors(tpl,ctx) {
    tpl=tpl||{};ctx=ctx||{};var errors=[];
    function check(kind,expected,actual){
      expected=scopeValue(expected);actual=scopeValue(actual);
      if(!expected)return;
      if(!actual){errors.push({field:kind,code:'missing_'+kind+'_scope',message:'The selected template is '+kind+'-specific, but the current '+kind+' is unresolved.'});return;}
      if(normText(expected)!==normText(actual))errors.push({field:kind,code:'mismatch_'+kind,message:'The selected template belongs to a different '+kind+'.'});
    }
    check('provider',tpl.providerId||tpl.provider_id||tpl.providerName||tpl.provider,ctx.providerId||ctx.provider_id||ctx.providerName||ctx.provider);
    check('facility',tpl.facilityId||tpl.facility_id||tpl.facilityName||tpl.facility,ctx.facilityId||ctx.facility_id||ctx.facilityName||ctx.facility);
    return errors;
  }
  function templateCompatibility(procedure,tpl,ctx) {
    var requested=procedureFacts(procedure), templateText=S(tpl&&tpl.name)+' '+((tpl&&tpl.keywords)||[]).join(' ')+' '+S(tpl&&tpl.text).slice(0,2400), actual=procedureFacts(templateText);
    var fields=['procedureType','region','approach'];
    if(tpl&&tpl.validatedFacts===true)fields=['procedureType','region','side','levels','levelCount','approach'];
    var errors=compareFacts(requested,actual,false,fields).concat(templateScopeErrors(tpl,ctx));
    return {pass:!errors.length,errors:errors,requested:requested,template:actual};
  }
  function resolveSelectedTemplate(procedure,tplText,ctx){
    var all=templates(),wanted=requestedTemplateId(ctx),matches=[],i,t;
    if(wanted){
      for(i=0;i<all.length;i++)if(S(all[i]&&(all[i].id||all[i].templateId))===wanted){t=all[i];break;}
      if(!t)return {tpl:null,error:'The selected template is no longer available.',code:'MLS_OPNOTE_TEMPLATE_IDENTITY'};
      if(S(t.text)!==S(tplText))return {tpl:null,error:'The selected template changed before drafting. Re-select it and retry.',code:'MLS_OPNOTE_TEMPLATE_STALE'};
      return {tpl:t,source:'id'};
    }
    for(i=0;i<all.length;i++)if(S(all[i]&&all[i].text)===S(tplText))matches.push(all[i]);
    if(matches.length===1)return {tpl:matches[0],source:'unique-text'};
    if(matches.length>1){
      /* Legacy/direct callers may not yet carry an id. Recover only when the
         requested procedure and current scope identify exactly one candidate;
         otherwise duplicate text is ambiguous and generation must fail closed. */
      var compatible=matches.filter(function(candidate){return templateCompatibility(procedure,candidate,ctx).pass;}),pc=procClass(procedure),exact=compatible.filter(function(candidate){return pc&&templateClass(candidate)===pc;});
      if(exact.length===1)return {tpl:exact[0],source:'unique-class'};
      if(compatible.length===1)return {tpl:compatible[0],source:'unique-scope'};
      return {tpl:null,error:'Multiple saved templates share this text. Re-select the intended template before drafting.',code:'MLS_OPNOTE_TEMPLATE_IDENTITY'};
    }
    return {tpl:{text:S(tplText)},source:'direct-text'};
  }
  function templateFields(note,tpl) {
    var n=normText(note), t=normText(tpl&&tpl.text), errors=[];
    var required=(tpl&&Array.isArray(tpl.requiredFields))?tpl.requiredFields:[];
    var prohibited=(tpl&&Array.isArray(tpl.prohibitedFields))?tpl.prohibitedFields:[];
    required.forEach(function(f){var key=normText(f);if(key&&n.indexOf(key)<0)errors.push({field:'requiredFields',code:'missing_required_field',message:'Required template field is missing: '+S(f).slice(0,80)});});
    prohibited.forEach(function(f){var key=normText(f);if(key&&n.indexOf(key)>=0)errors.push({field:'prohibitedFields',code:'prohibited_field',message:'Prohibited field is present: '+S(f).slice(0,80)});});
    if(n.indexOf('fluoroscopy time')>=0&&t.indexOf('fluoroscopy time')<0)errors.push({field:'prohibitedFields',code:'unrequested_fluoroscopy_time',message:'Fluoroscopy time is not required by the validated template.'});
    return errors;
  }
  function clinicalConsistency(note,procedure,tpl,ctx) {
    var requested=procedureFacts(procedure), actual=procedureFacts(procedureEvidence(note));
    var errors=compareFacts(requested,actual,true).concat(templateFields(note,tpl||{})).concat(templateScopeErrors(tpl,ctx));
    /* oni-2.9.0 containment fallback: when the strict procedure-section scan
       found NO levels but every requested level IS written somewhere in the
       draft, the fact was preserved — the extractor just could not attribute
       it to a heading. Only the MISSING case is forgiven; a draft whose
       procedure section states DIFFERENT levels still fails as a genuine
       clinical conflict. */
    var levelsVia='';
    if(requested.levels.length&&!actual.levels.length){
      var whole=levelsOf(S(note));
      var allPresent=requested.levels.every(function(l){return whole.indexOf(l)>=0;});
      if(allPresent){
        errors=errors.filter(function(e){return e.field!=='levels'&&e.field!=='levelCount';});
        levelsVia='full-note';
      }
    }
    return {pass:!errors.length,errors:errors,requested:requested,actual:actual,levelsVia:levelsVia};
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
    var proc = normText(stripNegated(procedure)), pc = procClass(procedure), pf=procedureFacts(procedure), pt = tokens(stripNegated(procedure)), list = templates();
    return list.map(function (t, index) {
      var name = normText(S(t.name) + ' ' + ((t.keywords || []).join(' ')));
      var body = normText(S(t.text).slice(0, 1800));
      var tc = templateClass(t), score = 0, compat=templateCompatibility(procedure,t);
      if (pc && tc) score += pc === tc ? 120 : -120;
      else if (pc && !tc) score -= 25;
      if(!compat.pass)score-=240;
      else if(pc){var tf=compat.template;if(pf.region&&tf.region&&sameRegion(pf.region,tf.region))score+=12;if(pf.approach&&tf.approach&&pf.approach===tf.approach)score+=18;}
      pt.forEach(function (w) {
        var special = /^(tfesi|esi|mbb|rfa|scs|bvn|caudal|interlaminar|genicular|facet|sacroiliac|intracept|kyphoplasty|vertebroplasty|discogram|trigger|bursa|l[1-5]|s[1-4]|c[1-8]|t\d{1,2})$/.test(w);
        if (name.indexOf(w) >= 0) score += special ? 6 : 3;
        else if (body.indexOf(w) >= 0) score += special ? 2 : 1;
      });
      ['left','right','bilateral','cervical','thoracic','lumbar'].forEach(function (w) {
        if (proc.indexOf(w) >= 0 && (name.indexOf(w) >= 0 || body.indexOf(w) >= 0)) score += 2;
      });
      return { tpl:t, score:score, procClass:pc, tplClass:tc, compatible:compat.pass, conflicts:compat.errors, index:index };
    }).sort(function (a, b) { return b.score - a.score || a.index - b.index; });
  }
  function best(procedure) {
    /* An explicit "no procedure performed" statement is a REAL no-match — it
       must never resolve to a procedure template, not even on a tie. */
    if (statesNoProcedure(procedure)) return { tpl:null, confident:false, reason:'text states no procedure was performed', score:0, noProcedure:true };
    var r = rank(procedure), top = r[0], second = r[1], list = templates();
    if (!top || !top.tpl) return { tpl:null, confident:false, reason:'no templates', score:0 };
    if(!top.compatible)return {tpl:null,candidate:top.tpl,confident:false,reason:'template conflicts with requested procedure',score:top.score,conflicts:top.conflicts,ranked:r};
    var classExact = !!(top.procClass && top.tplClass && top.procClass === top.tplClass);
    /* A one-template library is not clinical evidence. A blank/follow-up row
       used to receive that template at score 0 merely because there was no
       alternative. Require the same classified procedure-type proof that
       makes a multi-template class match safe; explicit bulk/manual selection
       remains available when the schedule genuinely carries no procedure. */
    if (list.length === 1) {
      if (classExact && top.score > 0) return { tpl:top.tpl, confident:true, reason:'procedure class', score:top.score };
      return { tpl:null, candidate:top.tpl, confident:false, reason:'no classified procedure signal', score:top.score, ranked:r };
    }
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
  function historyVisitBelongsTo(p, v) {
    if (!p || !v) return false;
    var pid=S(p.id).trim(), binding=S(v.identityBinding).trim();
    var declaredPatientId=S(v.patientId).trim();
    /* A verified binding cannot launder a contradictory row-level patient id.
       Both fields are immutable ownership claims; disagreement fails closed. */
    if(binding&&declaredPatientId&&binding!==declaredPatientId)return false;
    var owner=S(binding||declaredPatientId||v.patientExternalId||v.patient_external_id||v._mlsTargetPatientId).trim();
    var remote=/athena|legacy|grab|pullrec/i.test(S(v.source));
    /* Athena-derived history may influence procedure matching only when the
       encounter carries the same immutable patient binding and its reader
       marked that binding verified. A row merely stored in p.visits is not
       identity proof. Local/manual history remains usable unless it declares a
       conflicting owner or patient identity. */
    if(remote){if(!pid||binding!==pid||v.identityVerified!==true)return false;}
    else if(binding&&binding!==pid)return false;
    if(owner&&owner!==pid)return false;
    if(S(v.patientDob).trim()&&dobKey(v.patientDob)!==dobKey(p.dob))return false;
    if(S(v.patientName).trim()&&normText(v.patientName)!==normText(p.name))return false;
    return true;
  }
  function verifiedHistoryVisits(p) {
    if(!p)return [];
    var visits=[], raw=Array.isArray(p.visits)?p.visits:[];
    try{
      var hist=window.__mlsOpNoteHistory, internal=hist&&hist._internal;
      if(internal&&isFn(internal.getVisitsFor))visits=internal.getVisitsFor(p)||[];
      else if(window.__mlsVisitModel&&isFn(window.__mlsVisitModel.usableVisits))visits=window.__mlsVisitModel.usableVisits(p)||[];
      else visits=raw;
    }catch(e){visits=[];}
    /* A verified-Athena accessor may intentionally omit clinician-authored
       local rows. Add back only non-remote rows; the common ownership checks
       below still reject any row that declares a conflicting patient. */
    raw.forEach(function(v){if(!/athena|legacy|grab|pullrec/i.test(S(v&&v.source))&&visits.indexOf(v)<0)visits.push(v);});
    return (Array.isArray(visits)?visits:[]).filter(function(v){return historyVisitBelongsTo(p,v);});
  }
  function historySignal(p) {
    if (!p) return '';
    var visits = verifiedHistoryVisits(p).slice();
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
    if (direct.noProcedure) return { tplId:'', source:'no-procedure', score:0, reason:'The visit text states no procedure was performed' };
    if (direct.confident) return { tplId:direct.tpl.id, source:'reason', score:direct.score, reason:direct.reason };
    var p = exactPatient(name, dob, patientId), hs = historySignal(p), fromHistory = best(hs);
    if (fromHistory.confident) return { tplId:fromHistory.tpl.id, source:'history', score:fromHistory.score, reason:fromHistory.reason };
    return { tplId:'', source:'unmatched', score:0, reason:'No unambiguous procedure signal' };
  }
  /* ONE matcher for every surface: preview, prep, note formatting, and safety
     checks all resolve through this canonical entry (negation-aware,
     class-gated, confidence/margin thresholds, honest no-match). */
  function matchVisitText(visitText) {
    var r = best(visitText);
    if (r.noProcedure) return { tplId:'', noMatch:true, score:0, reason:r.reason };
    if (r.confident && r.tpl) return { tplId:r.tpl.id, noMatch:false, score:r.score, reason:r.reason };
    return { tplId:'', noMatch:true, score:r.score || 0, reason:r.reason || 'ambiguous' };
  }

  function newRow(name, reason, dob, dateStr, patientId, scope) {
    var m = bestFor(name, reason, dob, patientId);
    /* oni-2.10.0: the base _opNewRow gained a 6th `scope` param carrying the
       appointment's provider/facility identity — this owner must carry it too,
       or every prep row silently loses the scheduled provider and facility. */
    scope = scope || {};
    return { patientId:S(patientId), appt:{name:name,reason:reason||'',dob:dob||'',patientId:S(patientId), providerId:S(scope.providerId||scope.provider_id||''), providerName:S(scope.providerName||scope.provider_name||scope.provider||''), facilityId:S(scope.facilityId||scope.facility_id||scope.departmentId||scope.department_id||''), facilityName:S(scope.facilityName||scope.facility_name||scope.departmentName||scope.department_name||scope.location||'')}, proc:reason||'', dateStr:dateStr||'', tplId:m.tplId, tplManual:false, tplMatchSource:m.source, tplMatchReason:m.reason, note:'', missing:[], values:{}, gen:false };
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
    /* oni-2.10.0: a drafted note remembers the template that produced it. If the
       selection has since changed, say so loudly — the visible draft is STALE
       relative to the dropdown, and saving it would mislabel the note. */
    if (row.gen && row._genTplId && S(row.tplId) !== S(row._genTplId)) {
      var wasTpl = null; try { wasTpl = isFn(window.getTemplateById) ? window.getTemplateById(row._genTplId) : null; } catch (e) {}
      return { text:'(⚠ draft below is from “'+((wasTpl&&wasTpl.name)||'the previous template')+'” — Re-draft to apply this template)', color:'#b4231e' };
    }
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
    var t=S(line).trim(); if(!t) return '';
    var m=t.match(/^([^:]{2,70}):(?:\s+.*)?$/); var label=m?m[1].trim():t;
    /* Only colon-less document titles carry the whole-line length guard; a
       "HEADING: <content>" line stays a heading no matter how long its content
       is, so a draft that fills a section on the heading line itself can never
       lose that heading relative to the short placeholder line in the template. */
    if(!m && t.length>90) return '';
    var common=/^(patient|patient name|patient dob|dob|date of birth|mrn|age|sex|gender|date|date of procedure|date of operation|date of service|provider|provider name|provider npi|provider license|provider credentials|npi|license|physician|surgeon|assistant|facility|facility address|practice|pre.?operative diagnosis|post.?operative diagnosis|diagnosis|procedure(?:s)?(?: performed)?|anesthesia|type of anesthesia|indications?(?: for procedure)?|history|consent|findings?|technique|description of procedure|estimated blood loss|fluoroscopy time|injectate(?: per point)?|laterality|complications?|specimens?|disposition(?: \/ post.?procedure plan)?|post.?procedure plan|plan|follow.?up|medications?(?: injected| administered)?|time.?out|preparation|diagnosis codes?(?: icd.?10)?|procedure codes?(?: cpt)?|cpt|icd.?10)$/i.test(label);
    var caps=label.length>2 && label===label.toUpperCase() && /[A-Z]/.test(label);
    /* Uploaded templates routinely contain provider-defined Title Case
       headings (for example, "Pre-Procedure Verification:"). Keep the guard
       deliberately narrow: a short label-shaped colon line with no content is
       a section, while an inline custom label must be title-like rather than a
       prose sentence or a clock value. */
    var custom=false;
    if(m&&/^[A-Za-z][A-Za-z0-9 \/&()\-]{1,69}$/.test(label)){
      var tail=S(t.slice(t.indexOf(':')+1)).trim(), words=label.split(/\s+/), minor=/^(?:a|an|and|or|of|the|to|for|with|without|per)$/i;
      var titleLike=words.length<=6&&words.every(function(w,i){return minor.test(w)&&i>0||/^[A-Z0-9][A-Za-z0-9/&()\-]*$/.test(w);});
      custom=!tail||titleLike;
    }
    if(!m && !caps) return '';
    if(!common && !caps && !custom) return '';
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
      var h=headingLabel(line), literal=S(line), fullLiteral=literal;
      if(h){var colon=literal.indexOf(':');if(colon<0)return;literal=literal.slice(colon+1);}
      var masked=literal
        .replace(/\[\[[^\]]+\]\]/g,'\u0000').replace(/\[(?:FILL\s*:?\s*)?[^\]]+\]/gi,'\u0000')
        .replace(/\{\{[^}]+\}\}/g,'\u0000').replace(/<[^>]+>/g,'\u0000').replace(/_{2,}/g,'\u0000');
      masked.split('\u0000').forEach(function(part){
        var n=normText(part), words=n?n.split(/\s+/):[];
        /* Short labels and variable-only lines are covered by the heading check.
           Long literal clauses are template-owned boilerplate and must survive.
           A short concrete value on a heading line is also template-owned —
           e.g. "COMPLICATIONS: None." must not silently become a different
           statement merely because it contains only one word. Bind that short
           value to its heading so another incidental "none" cannot satisfy it. */
        if(words.length>=5 || n.length>=36)out.push(n);
        else if(h&&n&&masked.indexOf('\u0000')<0)out.push(normText(fullLiteral));
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

  /* Keep exact chart-owned identity values out of the model's discretion. */
  /* oni-2.6.3: identity facts (patient/DOB/dates/provider) ALWAYS stamp — a
     wrong identity is never acceptable. CONTENT facts (procedure) stamp only
     into an empty or placeholder-only line: a template's own "PROCEDURE:
     [FILL: side] sacroiliac joint injection…" is fixed wording the raw
     schedule string ("L SI joint inj P") must never clobber — doing so
     deleted a required fixed fragment and made fidelity unsatisfiable. */
  var SOFT_FACTS={procedure:1};
  function placeholderOnlyTail(tail){
    var t=S(tail).trim(); if(!t) return true;
    return /^(?:\s*(?:\[\[[^\]]+\]\]|\[(?:FILL\s*:?\s*)?[^\]]+\]|\{\{[^}]+\}\}|_{2,})\s*)+$/i.test(t);
  }
  function forceFacts(note, facts) {
    facts=facts||{};
    /* Clinical headings stamp only the first occurrence because a second
       "Procedure:" may begin technique prose. Identity headings are different:
       every repeated Patient/DOB/MRN/etc. slot must receive the exact current
       chart fact so no old identity placeholder/value can survive. */
    var used={};
    return S(note).split(/\r?\n/).map(function(line){
      var h=headingLabel(line), colon=line.indexOf(':');
      var repeatedIdentity=h&&IDENTITY_HEADINGS.test(h);
      if(!h||colon<0||(used[h]&&!repeatedIdentity)||!Object.prototype.hasOwnProperty.call(facts,h))return line;
      used[h]=1;
      if(SOFT_FACTS[h] && !placeholderOnlyTail(line.slice(colon+1)))return line;
      var value=S(facts[h]).trim()||'[['+h.replace(/\s+/g,'_')+']]';
      return line.slice(0,colon+1)+' '+value;
    }).join('\n');
  }

  /* Fill only explicitly marked clinical slots. This preserves the provider's
     fixed procedure wording while preventing a visible [FILL: side] from
     becoming an excuse to omit a known side or exact level. */
  function fillProcedureSlots(note,procedure) {
    var f=procedureFacts(procedure), typeLabels={tfesi:'transforaminal epidural steroid injection',interlaminar_esi:'interlaminar epidural steroid injection',caudal_esi:'caudal epidural steroid injection',facet_mbb:'medial branch block',facet_rfa:'medial branch radiofrequency ablation',si_injection:'sacroiliac joint injection'};
    var values={
      side:f.side?f.side.charAt(0).toUpperCase()+f.side.slice(1):'',laterality:f.side?f.side.charAt(0).toUpperCase()+f.side.slice(1):'',
      level:f.levels.join(', '),levels:f.levels.join(', '),'exact level':f.levels.join(', '),'exact levels':f.levels.join(', '),
      'level count':f.levelCount?S(f.levelCount):'','number of levels':f.levelCount?S(f.levelCount):'',
      approach:f.approach?f.approach.charAt(0).toUpperCase()+f.approach.slice(1):'',
      region:f.region?f.region.charAt(0).toUpperCase()+f.region.slice(1):'','anatomical region':f.region?f.region.charAt(0).toUpperCase()+f.region.slice(1):'',
      'procedure type':typeLabels[f.procedureType]||''
    };
    return S(note).replace(/\[\[([^\]]+)\]\]|\[(?:FILL\s*:\s*)?([^\]]+)\]|\{\{([^}]+)\}\}/gi,function(all,a,b,c){var key=normText(a||b||c).replace(/_/g,' '),value=values[key];return value||all;});
  }

  function sourceSections(note) {
    var out={}, cur=null;
    S(note).split(/\r?\n/).forEach(function(line){
      var h=headingLabel(line), colon=line.indexOf(':');
      if(h){
        cur={lines:[]}; if(!out[h])out[h]=cur;
        if(colon>=0&&S(line.slice(colon+1)).trim())cur.lines.push(S(line.slice(colon+1)).trim());
      } else if(cur&&S(line).trim()) cur.lines.push(line);
    });
    return out;
  }

  /* The model supplies clinical prose; this deterministic pass owns document
     structure. It emits only template headings, in template order, copies every
     fixed template line verbatim, and places same-heading draft content only in
     empty or explicit-placeholder slots. */
  function reanchor(note, templateText, facts) {
    var src=sourceSections(note), segs=[], cur=null;
    S(templateText).split(/\r?\n/).forEach(function(line){
      var h=headingLabel(line);
      if(h){cur={h:h,head:line,body:[]};segs.push(cur);}else if(cur){cur.body.push(line);}else{segs.push({h:'',head:line,body:[]});}
    });
    var out=[], usedFact={};
    segs.forEach(function(seg){
      if(!seg.h){out.push(seg.head);return;}
      /* facts stamp only the FIRST occurrence of a heading (see forceFacts) */
      var colon=seg.head.indexOf(':'), exact=colon>=0&&facts&&!usedFact[seg.h]&&Object.prototype.hasOwnProperty.call(facts,seg.h)?S(facts[seg.h]).trim():'', cand=(src[seg.h]&&src[seg.h].lines)||[];
      if(exact)usedFact[seg.h]=1;
      /* A colon-less ALL-CAPS line is a literal document title, never a fillable field. */
      if(colon<0){out.push(seg.head);seg.body.forEach(function(b){out.push(b);});return;}
      var tail=S(seg.head.slice(colon+1)), bodyJoined=seg.body.join('\n'), hasBody=S(bodyJoined).trim(), hasSlot=/\[\[[^\]]+\]\]|\[(?:FILL\s*:?\s*)?[^\]]+\]|\{\{[^}]+\}\}|_{2,}/i.test(tail+'\n'+bodyJoined);
      /* content facts never clobber a template line with real fixed wording */
      if(exact && SOFT_FACTS[seg.h] && !placeholderOnlyTail(tail)){exact='';delete usedFact[seg.h];}
      if(exact){out.push(seg.head.slice(0,colon+1)+' '+exact);}
      else if(S(tail).trim()&&!hasSlot){out.push(seg.head);}
      else if(!hasBody&&!hasSlot){out.push(seg.head+(cand.length?(' '+cand.join('\n')):(' [['+seg.h.replace(/\s+/g,'_')+']]')));}
      /* A tail that is exactly one placeholder takes the draft's same-heading
         content; without this, a "HEADING: [SLOT]" section came back as the
         bare placeholder and the model's clinical prose for it was dropped. */
      else if(cand.length&&/^\s*(?:\[\[[^\]]+\]\]|\[(?:FILL\s*:?\s*)?[^\]]+\]|\{\{[^}]+\}\}|_{2,})\s*$/i.test(tail)){out.push(seg.head.slice(0,colon+1)+' '+cand.join('\n'));}
      else {out.push(seg.head);}
      seg.body.forEach(function(b){
        if(/\[\[[^\]]+\]\]|\[(?:FILL\s*:?\s*)?[^\]]+\]|\{\{[^}]+\}\}|_{2,}/i.test(b)){
          if(cand.length&&/^\s*(?:\[\[[^\]]+\]\]|\[(?:FILL\s*:?\s*)?[^\]]+\]|\{\{[^}]+\}\}|_{2,})\s*$/i.test(b)) out.push.apply(out,cand);
          else out.push(b);
        } else out.push(b);
      });
    });
    return forceFacts(out.join('\n'),facts);
  }

  /* oni-2.5.0: doctors upload PAST NOTES as templates. Such a "template" is a
     flat paragraph carrying the PRIOR patient's name/DOB/dates/history, and the
     fidelity system would otherwise preserve that verbatim into every new
     draft. sanitizeTemplate makes it reusable and structured:
     1) every recognized "Heading:" is put on its own line, so airing, the
        heading-order fidelity check, forceFacts, and the fill box all see
        real sections instead of one blob;
     2) the VALUES of patient-identity and patient-specific headings are
        replaced with [[snake]] placeholders — the prior patient's identity
        and history can never survive into a new patient's draft. Everything
        else (the doctor's own standard technique wording) is kept verbatim. */
  var SPLIT_TITLES = /(^|\s+)(OPERATIVE REPORT|PROCEDURE NOTE)(?=\s)/g;
  var SPLIT_LABELS = ['description of procedure','indications for procedure','estimated blood loss','postoperative diagnosis','post-operative diagnosis','preoperative diagnosis','pre-operative diagnosis','medications injected','date of operation','date of procedure','date of service','type of anesthesia','fluoroscopy time','provider credentials','provider license','provider npi','provider name','facility address','date of birth','patient name','patient dob','patient','complications','disposition','indications','indication','anesthesia','facility','practice','physician','technique','laterality','injectate','follow-up','diagnosis','specimens','findings','procedure','provider','surgeon','consent','history','needle','levels','plan','npi','license','mrn','dob','age','sex'];
  /* boundary includes start-of-string/line so a label at position 0 is
     consumed WHOLE — otherwise the bare-word alternative ("diagnosis") could
     split "PREOPERATIVE DIAGNOSIS:" in the middle of the label itself */
  var SPLIT_RX = new RegExp('(^|\\s+)((?:' + SPLIT_LABELS.join('|').replace(/-/g, '\\-') + ')\\s*:)', 'gi');
  var IDENTITY_HEADINGS = /^(patient|patient name|patient dob|dob|date of birth|mrn|age|sex|gender|date|date of operation|date of procedure|date of service|physician|provider|provider name|provider npi|provider license|provider credentials|npi|license|surgeon|facility|facility address|practice)$/i;
  var SCRUB_HEADINGS = /^(patient|patient name|patient dob|dob|date of birth|mrn|age|sex|gender|date|date of operation|date of procedure|date of service|physician|provider|provider name|provider npi|provider license|provider credentials|npi|license|surgeon|facility|facility address|practice|history|procedure|pre.?operative diagnosis|post.?operative diagnosis|diagnosis|indications?(?: for procedure)?)$/i;
  function scrubHeadingMatch(line){return S(line).match(/^\s*([A-Za-z][A-Za-z /\-]{1,40}):(.*)$/);}
  function scrubSlot(label){return normText(label).replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');}
  function concreteIdentityValue(value){value=S(value).trim();return value&&!/^the patient$/i.test(value)&&!/^same\b/i.test(value)&&!/\[\[[^\]]+\]\]|\[(?:FILL\s*:?\s*)?[^\]]+\]|\{\{[^}]+\}\}|_{2,}/i.test(value);}
  function followingIdentityValue(lines,index){
    for(var i=index+1;i<lines.length;i++){
      var value=S(lines[i]).trim();if(!value)continue;
      if(scrubHeadingMatch(lines[i]))return null;
      /* Uppercase MRNs (e.g. OLD-7788) are values, not colon-less headings. */
      if(/^(?:OPERATIVE REPORT|PROCEDURE NOTE|HISTORY|PROCEDURE|FINDINGS|TECHNIQUE|COMPLICATIONS|DISPOSITION)$/i.test(value))return null;
      return concreteIdentityValue(value)?{index:i,value:value}:null;
    }
    return null;
  }
  function priorPatientNamePatterns(lines) {
    var variants=[],seen={};
    function add(parts){
      parts=(parts||[]).filter(Boolean);if(parts.length<2)return;
      var k=parts.join(' ').toLowerCase();if(seen[k])return;seen[k]=1;
      variants.push(new RegExp('\\b'+parts.map(function(part){return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('[\\s,.-]+')+'\\b','gi'));
    }
    for(var i=0;i<lines.length;i++){
      var m=scrubHeadingMatch(lines[i]);if(!m||!/^(patient|patient name)$/i.test(S(m[1]).trim()))continue;
      var value=S(m[2]).trim(),following=!value?followingIdentityValue(lines,i):null;if(following)value=following.value;
      if(!concreteIdentityValue(value))continue;
      var comma=value.split(','),parts=value.match(/[A-Za-z][A-Za-z'\-]*/g)||[];
      add(parts);
      if(comma.length===2){var last=comma[0].match(/[A-Za-z][A-Za-z'\-]*/g)||[],first=comma[1].match(/[A-Za-z][A-Za-z'\-]*/g)||[];add(first.concat(last));}
      else if(parts.length>=2)add([parts[parts.length-1]].concat(parts.slice(0,-1)));
    }
    return variants;
  }
  function priorIdentityValues(lines){
    var out=[];
    for(var i=0;i<lines.length;i++){
      var m=scrubHeadingMatch(lines[i]);if(!m)continue;
      var label=S(m[1]).trim();if(!IDENTITY_HEADINGS.test(label))continue;
      var value=S(m[2]).trim(),following=!value?followingIdentityValue(lines,i):null;
      if(following)value=following.value;
      if(concreteIdentityValue(value))out.push({label:label,key:scrubSlot(label),value:value,headingLine:i,valueLine:following&&following.index});
    }
    return out;
  }
  function escapeRx(value){return S(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
  function scrubNarrativeIdentity(line,values){
    var out=S(line);
    values.forEach(function(item){
      var v=escapeRx(item.value);if(!v)return;
      if(/^(patient|patient name)$/i.test(item.label))return;
      if(/^(patient dob|dob|date of birth)$/i.test(item.label)){
        out=out.replace(new RegExp('(\\b(?:dob|date\\s+of\\s+birth|born(?:\\s+on)?)\\b\\s*(?:is|was|[:#-])?\\s*)'+v,'gi'),'$1[['+item.key+']]');
      }else if(/^mrn$/i.test(item.label)){
        out=out.replace(new RegExp('(\\bmrn\\b\\s*(?:is|was|[:#-])?\\s*)'+v,'gi'),'$1[[mrn]]');
      }else if(/^age$/i.test(item.label)){
        out=out.replace(new RegExp('\\b'+v+'(?=\\s*-?year-?old\\b)','gi'),'[[age]]');
        out=out.replace(new RegExp('(\\bage\\b\\s*(?:is|was|[:#-])?\\s*)'+v+'\\b','gi'),'$1[[age]]');
      }
    });
    return out;
  }
  function sanitizeTemplate(tplText) {
    var t = S(tplText);
    t = t.replace(SPLIT_TITLES, '\n$2\n');
    t = t.replace(SPLIT_RX, '\n$2');
    var lines = t.split(/\r?\n/), namePatterns=priorPatientNamePatterns(lines), identityValues=priorIdentityValues(lines), skipLines={},multilineIdentity={};
    identityValues.forEach(function(item){if(item.valueLine!=null)multilineIdentity[item.headingLine]=item;});
    /* Scrubbing only the Patient: value left the same prior patient's name in
       a following HISTORY/body sentence, which fidelity then treated as fixed
       boilerplate. Neutralize only captured full-name variants; never remove a
       lone first/last word that could also be legitimate clinical wording. */
    if(namePatterns.length){
      lines=lines.map(function(line){var outLine=S(line);namePatterns.forEach(function(rx){rx.lastIndex=0;outLine=outLine.replace(rx,'the patient');});return outLine;});
    }
    var out = [], scrubbed = {};
    for (var i = 0; i < lines.length; i++) {
      if(skipLines[i])continue;
      var line = scrubNarrativeIdentity(lines[i],identityValues), m = scrubHeadingMatch(line);
      if (m && SCRUB_HEADINGS.test(m[1].trim())) {
        var label = m[1].trim(), key = label.toLowerCase(), val = S(m[2]).trim();
        var identity=IDENTITY_HEADINGS.test(label), following=identity&&!val?(multilineIdentity[i]||followingIdentityValue(lines,i)):null;
        if(following){skipLines[following.index!=null?following.index:following.valueLine]=1;val=following.value;}
        /* Every repeated identity or patient-specific clinical value is
           unsafe reusable input. The sole exception is a long duplicate
           "Procedure:" narrative, which some uploaded notes use as their
           technique paragraph; short procedure/laterality/level values are
           still converted to a slot. */
        var longProcedureNarrative=!identity&&scrubbed[key]&&/^procedure$/i.test(label)&&val.length>=80;
        var keep = longProcedureNarrative || (!identity&&!val) || /^same\b/i.test(val) || /\[\[[^\]]+\]\]|\[(?:FILL\s*:?\s*)?[^\]]+\]|_{2,}/i.test(val);
        scrubbed[key] = 1;
        out.push(keep ? line : (line.slice(0, line.indexOf(':') + 1) + ' [[' + scrubSlot(key) + ']]'));
      } else out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }

  /* oni-2.6.0: history/diagnosis placeholders that survive the model are
     filled DETERMINISTICALLY from the exact patient's own chart (problems +
     latest documented plan) — chart-grounded only, never invented. A slot the
     chart cannot answer stays visible for the doctor / fill box. */
  /* Real pulled charts keep the problem list INSIDE the Athena visit raw
     ("<Problem name> - Onset: MM/DD/YYYY"), with p.problems empty. Extract
     those verbatim names, ranked by overlap with THIS procedure so an SI
     injection picks "Sacroiliac joint pain" over "Lumbar back pain". */
  function chartProblems(p, procedure) {
    var out = [], seen = {};
    var direct = S(p.problems).replace(/\s+/g, ' ').trim();
    if (direct) direct.split(/[;\n]/).forEach(function (x) { x = S(x).trim(); if (x && !seen[x.toLowerCase()]) { seen[x.toLowerCase()] = 1; out.push(x); } });
    if (!out.length) {
      var raw = '';
      try { verifiedHistoryVisits(p).slice(0, 8).forEach(function (v) { raw += ' ' + S(v && v.raw); }); } catch (e) {}
      var re = /([A-Z][A-Za-z0-9 ,()\/-]{2,60}?)\s*-\s*Onset:\s*\d{1,2}\/\d{1,2}\/\d{2,4}/g, m;
      while ((m = re.exec(raw)) !== null && out.length < 6) {
        var nm = S(m[1]).trim();
        while (/^(problems?|reviewed|problem list|active|list)\s+/i.test(nm)) nm = nm.replace(/^(problems?|reviewed|problem list|active|list)\s+/i, '');
        if (nm.length > 2 && !seen[nm.toLowerCase()]) { seen[nm.toLowerCase()] = 1; out.push(nm); }
      }
    }
    if (out.length > 1 && S(procedure).trim()) {
      var pt = normText(procedure).split(/\s+/).filter(function (w) { return w.length >= 3; });
      out.sort(function (a, b) {
        function sc(x) { var n = normText(x), s = 0; pt.forEach(function (w) { if (n.indexOf(w) >= 0) s += w.length; }); return s; }
        return sc(b) - sc(a);
      });
    }
    return out;
  }
  function fillChartSlots(note, p, ctx, procedure) {
    if (!p) return S(note);
    var probList = chartProblems(p, procedure);
    var problems = probList.slice(0, 3).join('; ');
    /* oni-2.10.0: the top-ranked problem may only become the DIAGNOSIS when it
       plausibly relates to the requested procedure — token overlap with the
       procedure, or pain/MSK vocabulary (this is a pain/spine practice tool;
       "Lumbar spondylosis" legitimately drives a Caudal ESI despite sharing no
       tokens). An unrelated comorbidity (e.g. "Hypertension") must never be
       stamped as the pre-op diagnosis — that slot stays visible instead. */
    var PAIN_DX_RX = /pain|spondyl|radicul|facet|stenos|\bdisc\b|\bdisk\b|sacroiliac|si joint|\bjoint\b|spine|spinal|lumbar|cervical|thoracic|neuralg|neuropath|arthropath|myelopath|herniat|scoliosis|sciatica|tendinop|bursitis|arthritis|zygapophys|dorsal ramus|medial branch|vertebr|coccy|occipital/i;
    var diag = '';
    if (probList.length) {
      var relevant = true;
      if (S(procedure).trim()) {
        var pToks = normText(procedure).split(/\s+/).filter(function (w) { return w.length >= 3; });
        var topNorm = normText(probList[0]), overlap = 0;
        pToks.forEach(function (w) { if (topNorm.indexOf(w) >= 0) overlap += w.length; });
        relevant = overlap > 0 || PAIN_DX_RX.test(S(probList[0]));
      }
      if (relevant) diag = S(probList[0]).slice(0, 140);
    }
    var age = 0;
    try { var d = new Date(S(p.dob)); if (!isNaN(d.getTime())) { var now = new Date(); age = now.getFullYear() - d.getFullYear(); if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--; if (age <= 0 || age >= 130) age = 0; } } catch (e) {}
    var sex = S((ctx && ctx.sex) || p.sex || p.gender).trim();
    var bits = [];
    if (age && sex) bits.push(age + '-year-old ' + sex);
    if (problems) bits.push((bits.length ? 'with ' : '') + problems);
    var hist = bits.join(' ');
    var plan = '';
    try {
      var vs = verifiedHistoryVisits(p).slice();
      vs.sort(function(a,b){return S(b&&(b.date||b.created)).localeCompare(S(a&&(a.date||a.created)));});
      for (var i = 0; i < vs.length && !plan; i++) plan = S(vs[i] && vs[i].plan).replace(/\s+/g, ' ').trim();
    } catch (e) {}
    if (plan) hist = [hist, 'Most recent plan: ' + plan.slice(0, 160)].filter(Boolean).join('. ');
    if (hist) hist = hist.replace(/\.+$/, '') + '.';
    return S(note)
      .replace(/\[\[(history|clinical_history|patient_history)\]\]/gi, function (m) { return hist || m; })
      .replace(/\[\[(pre_?operative_diagnosis|diagnosis|indication|indications|indications_for_procedure)\]\]/gi, function (m) { return diag || m; });
  }

  function patientAge(dob){
    try{var d=new Date(S(dob));if(isNaN(d.getTime()))return null;var now=new Date(),age=now.getFullYear()-d.getFullYear();if(now.getMonth()<d.getMonth()||(now.getMonth()===d.getMonth()&&now.getDate()<d.getDate()))age--;return age>0&&age<130?age:null;}catch(e){return null;}
  }

  /* oni-2.4.0: a finished draft must READ like a document, not one blob.
     Deterministic spacing pass: exactly one blank line before every section
     heading (never before the first line), runs of 3+ newlines collapsed to
     one blank line. Line content is never altered, so a note that already
     passed fidelity still passes (headings/fixed wording are line-based). */
  function airSections(note) {
    var lines=S(note).split(/\r?\n/), out=[], sawContent=false;
    for (var i=0;i<lines.length;i++) {
      var line=lines[i], blank=!S(line).trim();
      if (blank) { if (out.length && S(out[out.length-1]).trim()) out.push(''); continue; }
      if (headingLabel(line) && sawContent && S(out[out.length-1]).trim()) out.push('');
      out.push(line); sawContent=true;
    }
    while (out.length && !S(out[out.length-1]).trim()) out.pop();
    return out.join('\n');
  }

  async function generateOnce(name,dateStr,procedure,tplText,ctx) {
    window.__mlsLastOpFidelityError='';window.__mlsLastOpFidelityPass=false;
    ctx=ctx||{};
    generationStage(ctx,'Confirming procedure','Verifying the exact patient and requested procedure.');
    var p=exactPatient(name,ctx.dob,ctx.patientId);
    if(!p||!S(ctx.patientId).trim()||S(p.id)!==S(ctx.patientId)){
      var ie=new Error('Op-note generation stopped: exact patient identity could not be verified.');ie.code='MLS_OPNOTE_IDENTITY';throw ie;
    }
    if(!S(tplText).trim()){var te=new Error('The selected op-note template is empty.');te.code='MLS_OPNOTE_TEMPLATE_EMPTY';throw te;}
    generationStage(ctx,'Loading validated template','Checking the selected template against procedure type, region, and approach.');
    var selectedResolution=resolveSelectedTemplate(procedure,tplText,ctx),selectedTpl=selectedResolution.tpl;
    if(!selectedTpl){var tie=new Error(selectedResolution.error||'The selected template identity could not be verified.');tie.code=selectedResolution.code||'MLS_OPNOTE_TEMPLATE_IDENTITY';throw tie;}
    var tplCheck=templateCompatibility(procedure,selectedTpl||{text:tplText},ctx);
    if(!tplCheck.pass){var tce=new Error('Draft stopped: the selected template conflicts with the requested procedure type, region, or approach. Choose a compatible validated template.');tce.code='MLS_OPNOTE_TEMPLATE_CONFLICT';tce.details=tplCheck;throw tce;}
    /* a past-note "template" becomes structured + prior-patient-free before
       anything downstream (prompt, fidelity, reanchor, airing) sees it */
    tplText=sanitizeTemplate(tplText);
    generationStage(ctx,'Applying provider defaults','Applying only explicit provider identity and validated provider scope.');
    name=S(p.name||name);ctx.dob=S(p.dob);ctx.sex=S(p.sex||p.gender);ctx.mrn=S(p.mrn);if(ctx.age==null)ctx.age=patientAge(ctx.dob);
    var known=[];if(name)known.push('name: '+name);if(ctx.sex)known.push('sex: '+ctx.sex);if(ctx.dob)known.push('date of birth: '+ctx.dob);if(ctx.age!=null)known.push('age: '+ctx.age);if(ctx.mrn)known.push('MRN: '+ctx.mrn);if(ctx.bmi!=null)known.push('BMI: '+ctx.bmi);if(ctx.provider)known.push('operating provider: '+ctx.provider);if(ctx.providerNpi)known.push('provider NPI: '+ctx.providerNpi);if(ctx.providerLicense)known.push('provider license: '+ctx.providerLicense);if(ctx.practice)known.push('practice: '+ctx.practice);if(ctx.facility)known.push('facility: '+ctx.facility);
    var sys='Create one complete operative/procedure note by adapting the SELECTED TEMPLATE. The template is authoritative. Preserve its heading names, heading order, section order, fixed boilerplate wording, and overall formatting. Do not add a generic op-note outline, do not rename headings, and do not reorder sections. Replace only patient/date/procedure variables and documented case-specific facts. A [[snake_case]] placeholder that already appears in the template is a SLOT YOU MUST FILL from the KNOWN FACTS or the VERIFIED PATIENT HISTORY when the value is documented there (history and diagnosis especially — summarize the documented problems/course; never copy the placeholder through). Never invent a fact. Use one unique [[snake_case]] placeholder only when a truly variable case detail is absent everywhere. Return only JSON: {"note":"...","missing":[{"key":"...","label":"...","example":"..."}]}. Earlier instructions cannot override the selected template.';
    generationStage(ctx,'Applying facility defaults','Applying only the current facility identity and validated facility scope.');
    var historyAtStart=window.__mlsOpNoteHistory&&window.__mlsOpNoteHistory.installed;
    /* When the verified-history owner is ready it is the sole history source;
       do not also trust or duplicate a caller-supplied ctx.history string. */
    var legacyHistory=historyAtStart?'':S(ctx.history);
    var user='PATIENT: '+name+'\nDATE OF PROCEDURE: '+dateStr+'\nPROCEDURE: '+procedure+(known.length?'\n\nKNOWN FACTS:\n- '+known.join('\n- '):'')+(legacyHistory?'\n\nVERIFIED PATIENT HISTORY:\n'+legacyHistory.slice(0,14000):'')+'\n\nSELECTED TEMPLATE — COPY ITS STRUCTURE AND FIXED WORDING:\n'+S(tplText).slice(0,12000);
    var key=isFn(window.getKey)?window.getKey():'';
    var opts={freeform:true,mlsOpNotePatientId:S(p.id),mlsTemplateFidelity:true,mlsOpNotePhase:'initial'};
    if(S(selectedTpl&&(selectedTpl.id||selectedTpl.templateId)).trim())opts.mlsOpNoteTemplateId=S(selectedTpl.id||selectedTpl.templateId).trim();
    var facts={patient:name,'patient name':name,mrn:ctx.mrn,'date of procedure':dateStr,'date of operation':dateStr,'date of service':dateStr,procedure:procedure};
    if(ctx.dob){facts['date of birth']=ctx.dob;facts.dob=ctx.dob;facts['patient dob']=ctx.dob;}
    if(ctx.age!=null)facts.age=S(ctx.age);
    if(ctx.sex){facts.sex=ctx.sex;facts.gender=ctx.sex;}
    if(ctx.provider){facts.provider=ctx.provider;facts['provider name']=ctx.provider;facts.physician=ctx.provider;facts.surgeon=ctx.provider;}
    if(ctx.providerNpi){facts.npi=ctx.providerNpi;facts['provider npi']=ctx.providerNpi;}
    if(ctx.providerLicense){facts.license=ctx.providerLicense;facts['provider license']=ctx.providerLicense;}
    if(ctx.practice)facts.practice=ctx.practice;
    if(ctx.facility)facts.facility=ctx.facility;
    if(ctx.facilityAddress)facts['facility address']=ctx.facilityAddress;
    if(ctx.__mlsProgressHandle)opts.mlsRequestId=ctx.__mlsProgressHandle.requestId;
    generationStage(ctx,'Drafting procedure section','The model is drafting the complete template-owned procedure note.');
    var first=parseResult(await window.aiCallRaw(sys,user,key,opts));
    generationStage(ctx,'Drafting findings','Preserving chart-grounded findings and filling explicit clinical slots.');
    first.note=fillChartSlots(fillProcedureSlots(forceFacts(first.note,facts),procedure),p,ctx,procedure);
    var histApi=window.__mlsOpNoteHistory, histValidation=null;
    if(histApi&&histApi.installed){
      histValidation=isFn(histApi.validateBinding)?histApi.validateBinding(opts):{ok:false,reason:'history-binding-validator-unavailable'};
      if(!histValidation||!histValidation.ok){var ve=new Error('Op-note generation stopped because the exact patient or verified history changed while the draft was being created.');ve.code='MLS_OPNOTE_IDENTITY';ve.reason=histValidation&&histValidation.reason||'history-binding-invalid';throw ve;}
    }
    generationStage(ctx,'Checking side and level','Comparing procedure type, region, side, exact levels, level count, and approach.');
    var check=fidelity(first.note,tplText), clinical=clinicalConsistency(first.note,procedure,selectedTpl||{text:tplText},ctx);
    generationStage(ctx,'Checking required fields','Checking required, optional, and prohibited template language.');
    generationStage(ctx,'Running final consistency check','Verifying clinical facts and exact template structure together.');
    if(check.pass&&clinical.pass){first.note=attestNote(airSections(first.note),ctx);first.templateFidelity=check;first.clinicalConsistency=clinical;return first;}
    /* The history wrapper freezes an exact-patient context binding on the first
       request. If that wrapper is installed, a repair must carry the same
       binding; it may not fall back to the shorter pre-injection ctx.history. */
    var histBinding=opts.mlsVerifiedHistoryBinding;
    if(histApi&&histApi.installed&&(!histBinding||S(histBinding.patientId)!==S(p.id))){var he=new Error('Op-note repair stopped because verified patient history was not bound to the draft.');he.code='MLS_OPNOTE_IDENTITY';throw he;}
    var stillExact=exactPatient(name,ctx.dob,ctx.patientId);
    if(!stillExact||S(stillExact.id)!==S(p.id)){var pe=new Error('Op-note repair stopped because the patient changed during generation.');pe.code='MLS_OPNOTE_IDENTITY';throw pe;}
    var repairSys='Repair the draft so it follows the selected template exactly AND preserves every requested clinical fact. Output the same JSON shape only. The output heading labels and heading order must exactly equal this list: '+check.expected.join(' | ')+'. The procedure must remain exactly: '+S(procedure)+'. Never change procedure type, anatomical region, side, exact level(s), number of levels, or approach. Remove added headings, restore missing headings, restore the template order, and copy every fixed template sentence verbatim and in the same sequence. Do not invent clinical facts.';
    var frozenHistory=histBinding&&S(histBinding.context);
    var repairUser='SELECTED TEMPLATE:\n'+S(tplText).slice(0,12000)+'\n\nDRAFT TO REPAIR:\n'+S(first.note).slice(0,14000)+(frozenHistory?'\n\n'+frozenHistory:'')+'\n\nORIGINAL PATIENT/PROCEDURE CONTEXT:\n'+user.slice(0,10000);
    opts.mlsOpNotePhase='repair';
    var repaired=parseResult(await window.aiCallRaw(repairSys,repairUser,key,opts));
    repaired.note=fillChartSlots(fillProcedureSlots(forceFacts(repaired.note,facts),procedure),p,ctx,procedure);
    generationStage(ctx,'Checking side and level','Rechecking the repaired procedure facts.');
    var check2=fidelity(repaired.note,tplText);
    if(!check2.pass){repaired.note=fillChartSlots(fillProcedureSlots(reanchor(repaired.note,tplText,facts),procedure),p,ctx,procedure);check2=fidelity(repaired.note,tplText);}
    if(!check2.pass){window.__mlsLastOpFidelityError='Draft stopped because it did not preserve the selected template. Nothing was saved; retry or confirm the template.';var fe=new Error(window.__mlsLastOpFidelityError);fe.code='MLS_OPNOTE_TEMPLATE_FIDELITY';fe.details=check2;throw fe;}
    generationStage(ctx,'Checking required fields','Rechecking required and prohibited template fields.');
    var clinical2=clinicalConsistency(repaired.note,procedure,selectedTpl||{text:tplText},ctx);
    generationStage(ctx,'Running final consistency check','Completing the repaired note consistency check.');
    if(!clinical2.pass){var fields=[];clinical2.errors.forEach(function(x){if(fields.indexOf(x.field)<0)fields.push(x.field);});var detail=clinical2.errors.slice(0,2).map(function(x){return x.message;}).join(' ');window.__mlsLastOpFidelityError='Draft stopped because the generated note changed or omitted requested clinical facts ('+fields.join(', ')+'). '+detail+' Nothing was saved; confirm the procedure and retry.';var ce=new Error(window.__mlsLastOpFidelityError);ce.code='MLS_OPNOTE_CLINICAL_CONFLICT';ce.details=clinical2;throw ce;}
    repaired.note=attestNote(airSections(repaired.note),ctx);repaired.templateFidelity=check2;repaired.clinicalConsistency=clinical2;return repaired;
  }

  /* oni-2.10.0: the deterministic provider/facility attestation footer is owned
     by the prep module (opnp); since this owner replaced _genOpNote outright,
     opnp's wrapper never runs — so the pipeline invites it back explicitly.
     Validation (fidelity + clinical) always runs BEFORE the footer is added,
     and the footer emits [[blanks]] for anything unknown rather than inventing. */
  function attestNote(note, ctx) {
    try {
      var prep = window.__mlsOpNotePrep;
      if (prep && prep.installed && isFn(prep.attest)) return S(prep.attest(note, ctx)) || S(note);
    } catch (e) {}
    return S(note);
  }

  function copyCtx(ctx){var out={};ctx=ctx||{};for(var k in ctx)if(Object.prototype.hasOwnProperty.call(ctx,k)&&k!=='__mlsProgressHandle')out[k]=ctx[k];return out;}
  function generate(name,dateStr,procedure,tplText,ctx) {
    ctx=ctx||{};
    var gkey=generationKey(dateStr,procedure,tplText,ctx),existing=generationByKey[gkey];
    if(existing&&!existing.settled)return existing.promise;
    var pkey=generationPatientKey(name,ctx),prior=generationByPatient[pkey];
    if(prior&&!prior.settled){prior.obsolete=true;try{if(prior.progress)prior.progress.cancel('Superseded by a newer op-note request.');}catch(e){}}
    var entry={key:gkey,patientKey:pkey,settled:false,obsolete:false,canceled:false,progress:null,promise:null};
    var runCtx=copyCtx(ctx),provided=ctx.__mlsProgressHandle,progressApi=window.__mlsLoadingCalm;
    if(provided)entry.progress=provided;
    else if(progressApi&&progressApi.installed&&isFn(progressApi.start)){
      var retryCtx=copyCtx(ctx);
      entry.progress=progressApi.start({
        key:'opnote:'+pkey,kind:'opnote',label:'Generating operative note',stages:GENERATION_STAGES,total:GENERATION_STAGES.length,
        timeoutMs:3*60*1000,replace:true,cancelable:true,maxAttempts:2,patient:name,provider:ctx.provider,selectedDate:dateStr,
        cancel:function(){entry.canceled=true;},
        retry:function(next){var c=copyCtx(retryCtx);c.__mlsProgressHandle=next;var retried=generate(name,dateStr,procedure,tplText,c);if(retried&&isFn(retried.catch))retried.catch(function(){});return retried;}
      });
    }
    if(entry.progress)runCtx.__mlsProgressHandle=entry.progress;
    generationByKey[gkey]=entry;generationByPatient[pkey]=entry;
    entry.promise=Promise.resolve().then(function(){return generateOnce(name,dateStr,procedure,tplText,runCtx);}).then(function(result){
      if(entry.obsolete||generationByPatient[pkey]!==entry){var se=new Error('An older op-note response was ignored because a newer request is active.');se.code='MLS_OPNOTE_STALE';throw se;}
      if(entry.canceled){var ce=new Error('Op-note generation was canceled safely.');ce.code='MLS_OPNOTE_CANCELED';throw ce;}
      window.__mlsLastOpFidelityPass=true;
      generationStage(runCtx,'Note ready','The template and requested clinical facts passed final validation.');
      if(entry.progress)entry.progress.complete('Operative note ready.');
      return result;
    }).catch(function(err){
      if(!(err&&(err.code==='MLS_OPNOTE_STALE'||err.code==='MLS_OPNOTE_CANCELED'))){
        if(entry.progress)entry.progress.fail(err);
        /* oni-2.10.0: every real failure (identity, template conflict, empty
           template, network/server) surfaces its actionable reason on the same
           channel the fidelity failures already use, so the UI never has to
           fall back to a generic "try again". */
        try{ if(!window.__mlsLastOpFidelityError) window.__mlsLastOpFidelityError=S(err&&err.message||'').trim()||'Op-note generation failed.'; }catch(e2){}
      }
      throw err;
    }).then(function(result){entry.settled=true;if(generationByKey[gkey]===entry)delete generationByKey[gkey];if(generationByPatient[pkey]===entry)delete generationByPatient[pkey];return result;},function(err){entry.settled=true;if(generationByKey[gkey]===entry)delete generationByKey[gkey];if(generationByPatient[pkey]===entry)delete generationByPatient[pkey];throw err;});
    return entry.promise;
  }
  /* These markers deliberately stop the two legacy heartbeat wrappers from
     taking ownership back after this final template-fidelity owner installs. */
  generate.__mlsopWrapped=true;
  generate.__opnpWrapped=true;
  generate.__mlsOpTemplateOwner=true;

  function rowGenerationCtx(row){
    var ctx={},base=null,appt=row&&row.appt||{};
    try{if(isFn(window._opPatientCtx))base=window._opPatientCtx(appt.name,appt.dob,row&&row.patientId);}catch(e){}
    [base,row&&row._ctx].forEach(function(src){if(!src)return;for(var k in src)if(Object.prototype.hasOwnProperty.call(src,k))ctx[k]=src[k];});
    ctx.templateId=S(row&&row.tplId);
    if(!ctx.providerId)ctx.providerId=S(appt.providerId||appt.provider_id);
    var apptProvider=S(appt.providerName||appt.provider_name||appt.provider).trim();
    if(apptProvider){
      var priorProvider=S(ctx.provider||ctx.providerName).toLowerCase().replace(/\b(?:md|do|np|pa(?:-?c)?|rn|dpm|dds|dmd|phd|facs|faap|faan)\b\.?/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
      var nextProvider=apptProvider.toLowerCase().replace(/\b(?:md|do|np|pa(?:-?c)?|rn|dpm|dds|dmd|phd|facs|faap|faan)\b\.?/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
      ctx.provider=apptProvider;ctx.providerName=apptProvider;
      if(priorProvider&&nextProvider&&priorProvider!==nextProvider){delete ctx.providerNpi;delete ctx.providerLicense;delete ctx.providerCredentials;}
    }
    if(!ctx.facilityId)ctx.facilityId=S(appt.facilityId||appt.facility_id||appt.departmentId||appt.department_id);
    var apptFacility=S(appt.facilityName||appt.facility_name||appt.departmentName||appt.department_name||appt.facility||appt.location).trim();
    if(apptFacility){
      var priorFacility=normText(ctx.facility||ctx.facilityName);
      ctx.facility=apptFacility;ctx.facilityName=apptFacility;
      if(priorFacility&&priorFacility!==normText(apptFacility))delete ctx.facilityAddress;
    }
    return ctx;
  }

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
    if(isFn(one)&&!one.__oni){var oneWrap=async function(i){var row=(window._opPrep||[])[i];window.__mlsLastOpFidelityPass=false;if(row&&!row.tplManual){var m=bestFor(row.appt.name,row.proc||row.appt.reason,row.appt.dob,row.patientId);row.tplId=m.tplId;row.tplMatchSource=m.source;row.tplMatchReason=m.reason;syncTplStatus(i);}if(row&&row.tplId){var chosen=isFn(window.getTemplateById)?window.getTemplateById(row.tplId):null;var compat=templateCompatibility(row.proc||row.appt.reason,chosen||{},rowGenerationCtx(row));if(!compat.pass){window.__mlsLastOpFidelityError='Draft stopped: the selected template conflicts with the requested procedure type, region, approach, provider, or facility.';toast(window.__mlsLastOpFidelityError,'err');var stc=document.getElementById('opPrepStatus');if(stc)stc.textContent=window.__mlsLastOpFidelityError;return false;}}
      /* oni-2.10.0: visible in-flight state — the clicked Draft button disables
         with an honest label while this row generates (single-flight already
         dedupes; this makes it VISIBLE). */
      var busyBtn=null;try{busyBtn=document.querySelector('#opPrepList button[onclick="opPrepGenerateOne('+i+')"]');if(busyBtn){busyBtn.disabled=true;busyBtn.dataset.mlsBusyLabel=busyBtn.textContent;busyBtn.textContent='⏳ Drafting…';}}catch(eB){}
      var ok=false;
      try{
        await one(i);
        ok=!!(row&&row.gen&&S(row.note).trim()&&window.__mlsLastOpFidelityPass);
      } finally {
        try{if(busyBtn){busyBtn.disabled=false;if(busyBtn.dataset.mlsBusyLabel){busyBtn.textContent=busyBtn.dataset.mlsBusyLabel;delete busyBtn.dataset.mlsBusyLabel;}}}catch(eB2){}
      }
      /* remember WHICH template produced this draft, for the staleness guard */
      if(ok&&row){row._genTplId=S(row.tplId);syncTplStatus(i);}
      if(!ok&&window.__mlsLastOpFidelityError)toast(window.__mlsLastOpFidelityError,'err');return ok;};oneWrap.__oni=true;oneWrap.__opnpWrapped=true;oneWrap.__mlsOpTemplateOwner=true;window.opPrepGenerateOne=oneWrap;}
    var all=window.opPrepGenerateAll;
    if(isFn(all)&&!all.__oni){var allWrap=async function(){var rows=window._opPrep||[],st=document.getElementById('opPrepStatus'),ok=0,failed=0;for(var i=0;i<rows.length;i++){if(st)st.textContent='Drafting '+(i+1)+'/'+rows.length+' — '+rows[i].appt.name+'…';if(await window.opPrepGenerateOne(i))ok++;else failed++;}if(st)st.textContent=failed?('Drafted '+ok+' of '+rows.length+'. '+failed+' need a confirmed template or a retry.'):('✅ Drafted all '+ok+' op note'+(ok===1?'':'s')+' with template structure verified.');return {drafted:ok,failed:failed};};allWrap.__oni=true;window.opPrepGenerateAll=allWrap;}
  }

  window.__mlsOpNoteIntegrity={installed:true,version:VERSION,classify:procClass,parseProcedureFacts:procedureFacts,templateCompatibility:templateCompatibility,clinicalConsistency:clinicalConsistency,rank:rank,best:best,bestFor:bestFor,matchVisitText:matchVisitText,stripNegated:stripNegated,statesNoProcedure:statesNoProcedure,headings:headings,fixedFragments:fixedFragments,fidelity:fidelity,forceFacts:forceFacts,fillProcedureSlots:fillProcedureSlots,reanchor:reanchor,airSections:airSections,sanitizeTemplate:sanitizeTemplate,chartProblems:chartProblems,generate:generate,_historyVisitBelongsTo:historyVisitBelongsTo,_verifiedHistoryVisits:verifiedHistoryVisits,_resolveSelectedTemplate:resolveSelectedTemplate,_generationKey:generationKey,_rowGenerationCtx:rowGenerationCtx};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
