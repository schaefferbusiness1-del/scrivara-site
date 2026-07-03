/* feat_agent_actions2 — one-tap actions in the 🤖 MLS Agent (item #3, 2026-07-03).
   Additive + safe. Inserts a chip bar above the Agent's input row (#mlsP1AgIn inside panel #mlsP1Ag).
   "📧 Send portal login" opens the existing portal-invite for the active patient; the other chips type
   a plain command into the Agent's real input (#mlsP1AgQ) and click send (#mlsP1AgSend), using the
   Agent's own engine. Nothing signs/sends to Athena on its own. */
(function(){
  "use strict";
  if(window.__mlsAgentActions) return; window.__mlsAgentActions=true;

  function agentSend(text){
    try{
      var i=document.getElementById('mlsP1AgQ'), s=document.getElementById('mlsP1AgSend');
      if(!i||!s) return;
      var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i),'value');
      if(d&&d.set) d.set.call(i,text); else i.value=text;
      i.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ try{ s.click(); }catch(e){} }, 60);
    }catch(e){}
  }

  var ACTIONS=[
    { label:'📧 Send portal login', run:function(){
        var b=document.getElementById('mlsPortalInviteBtn');
        if(b){ b.click(); } else { alert('Select a patient first, then tap “Send portal login”.'); }
    }},
    { label:'🗓️ Prep tomorrow’s op notes', run:function(){ agentSend('Prep all of tomorrow’s op notes'); } },
    { label:'📥 Pull today’s patients', run:function(){ agentSend('Run the Athena pull for today'); } }
  ];

  function inject(){
    try{
      var panel=document.getElementById('mlsP1Ag'), inRow=document.getElementById('mlsP1AgIn');
      if(!panel || !inRow || panel.offsetParent===null) return;   // only when the Agent panel is open
      if(document.getElementById('mlsAgentActBar')) return;       // idempotent
      var bar=document.createElement('div');
      bar.id='mlsAgentActBar';
      bar.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px 6px';
      ACTIONS.forEach(function(a){
        var b=document.createElement('button');
        b.type='button'; b.textContent=a.label; b.setAttribute('data-mlsagentact','1');
        b.style.cssText='font-size:12px;border:1px solid #cfe0f3;background:#fff;color:#15528f;border-radius:999px;padding:5px 10px;cursor:pointer;font-family:inherit;line-height:1.2';
        b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
        b.addEventListener('mouseleave',function(){ b.style.background='#fff'; });
        b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); a.run(); });
        bar.appendChild(b);
      });
      inRow.parentNode.insertBefore(bar, inRow);
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
})();
