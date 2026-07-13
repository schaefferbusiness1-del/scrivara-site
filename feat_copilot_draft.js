/* feat_copilot_draft — one-tap "draft on command" quick-actions in the Copilot (item #2, 2026-07-03).
   Additive + safe: adds draft chips next to the Copilot's existing quick chips. Clicking one drops a
   strong drafting prompt (for the ACTIVE patient) into the Copilot input and sends it — using the
   Copilot's existing send path + patient context. No fetch wrapping, no data changes. */
(function(){
  "use strict";
  if(window.__mlsCopilotDraft) return; window.__mlsCopilotDraft=true;

  function activeName(){
    try{ var ap=window.activePatient; if(typeof ap==='function') ap=ap(); return (ap&&ap.name)?ap.name:null; }catch(e){ return null; }
  }

  var DRAFTS = [
    { label:'✍️ Draft op note', prompt:function(n){ return 'Draft a complete operative note for '+(n||'the active patient')+' for their planned/most recent procedure. Use standard operative-note structure: Preoperative diagnosis, Postoperative diagnosis, Procedure, Surgeon, Assistant, Anesthesia, Indications, Findings, Technique (numbered operative steps), Implants/Instrumentation, Estimated blood loss, Complications, Specimens, Disposition. Pull the procedure and clinical details from this patient’s record; wherever a specific detail is not documented, insert a clearly-marked [fill in] placeholder rather than inventing it.'; } },
    { label:'✍️ After-visit summary', prompt:function(n){ return 'Write a clear, patient-friendly after-visit summary for '+(n||'the active patient')+' based on their record and today’s visit: what we discussed, any diagnosis in plain language, medication changes, instructions/precautions, and next steps / follow-up. Warm, plain English, no jargon.'; } },
    { label:'✍️ Referral letter', prompt:function(n){ return 'Draft a referral letter to physical therapy for '+(n||'the active patient')+' based on their spine/pain diagnoses and history. Include the referring diagnosis with ICD-10 if known, brief relevant history and exam, precautions, and specific PT goals/frequency. Professional letter format.'; } }
  ];

  function sendPrompt(text){
    try{
      if(typeof window.openCopilotDock==='function') window.openCopilotDock();
      var input=document.getElementById('copilotInput');
      var send=document.getElementById('copilotSendBtn');
      if(!input||!send) return;
      var set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value');
      if(set&&set.set) set.set.call(input,text); else input.value=text;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ try{ send.click(); }catch(e){} }, 60);
    }catch(e){}
  }

  function inject(){
    try{
      var wrap=document.getElementById('copilotChips');
      if(!wrap) return;
      // only add once the app's own chips are present (dock open) and ours aren't
      if(wrap.children.length===0) return;
      if(wrap.querySelector('[data-mlsdraft]')) return;
      var model=wrap.children[0]; // clone an existing chip for native styling
      var n=activeName();
      DRAFTS.forEach(function(d){
        var chip;
        if(model && model.cloneNode){ chip=model.cloneNode(true); chip.removeAttribute('id'); chip.textContent=d.label; }
        else { chip=document.createElement('button'); chip.textContent=d.label; chip.style.cssText='font-size:12.5px;border:1px solid #cfe0f3;background:#fff;color:#204034;border-radius:999px;padding:6px 11px;cursor:pointer;margin:3px'; }
        chip.setAttribute('data-mlsdraft','1');
        chip.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); sendPrompt(d.prompt(activeName())); }, true);
        wrap.appendChild(chip);
      });
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
  if(document.readyState!=='loading') inject(); else document.addEventListener('DOMContentLoaded', inject);
})();
