/* feat_agent_actions — add one-tap actions to the 🤖 MLS Agent quick-action bar (item #3, 2026-07-03).
   Additive + safe. "📧 Send portal login" opens the existing portal-invite for the active patient;
   "🗓️ Prep tomorrow's op notes" and "📥 Pull today's patients" hand a plain command to the Agent's
   own engine (types into #mlsP1AgIn + clicks #mlsP1AgSend). No new backend actions, no data changes,
   nothing signs/sends to Athena — it just triggers what the app already does. */
(function(){
  "use strict";
  if(window.__mlsAgentActions) return; window.__mlsAgentActions=true;

  function agentSend(text){
    try{
      var input=document.getElementById('mlsP1AgIn'), send=document.getElementById('mlsP1AgSend');
      if(!input||!send) return;
      var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value');
      if(d&&d.set) d.set.call(input,text); else input.value=text;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ try{ send.click(); }catch(e){} }, 60);
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
      var q=document.getElementById('mlsP1AgQ');
      if(!q || q.offsetParent===null) return;           // only when the Agent panel is open
      if(q.querySelector('[data-mlsagentact]')) return;  // idempotent
      ACTIONS.forEach(function(a){
        var b=document.createElement('button');
        b.type='button'; b.textContent=a.label; b.setAttribute('data-mlsagentact','1');
        b.style.cssText='font-size:12.5px;border:1px solid #cfe0f3;background:#fff;color:#204034;border-radius:999px;padding:6px 11px;cursor:pointer;margin:3px;font-family:inherit';
        b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
        b.addEventListener('mouseleave',function(){ b.style.background='#fff'; });
        b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); a.run(); });
        q.appendChild(b);
      });
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
})();
