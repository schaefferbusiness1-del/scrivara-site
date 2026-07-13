/* feat_agent_actions3 — MLS Agent one-tap actions (item #3, 2026-07-03). Supersedes v2:
   the panel is position:fixed so offsetParent is null even when open — use bounding-rect width to
   detect "open" instead. Runs first + sets the shared guard so the older v2 below no-ops. Additive/safe. */
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
      var inRow=document.getElementById('mlsP1AgIn');
      if(!inRow) return;
      if(inRow.getBoundingClientRect().width < 5) return;   // panel not open/visible yet
      if(document.getElementById('mlsAgentActBar')) return; // idempotent
      var bar=document.createElement('div');
      bar.id='mlsAgentActBar';
      bar.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px 6px';
      ACTIONS.forEach(function(a){
        var b=document.createElement('button');
        b.type='button'; b.textContent=a.label; b.setAttribute('data-mlsagentact','1');
        b.style.cssText='font-size:12px;border:1px solid #cfe0f3;background:#fff;color:#204034;border-radius:999px;padding:5px 10px;cursor:pointer;font-family:inherit;line-height:1.2';
        b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
        b.addEventListener('mouseleave',function(){ b.style.background='#fff'; });
        b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); a.run(); });
        bar.appendChild(b);
      });
      inRow.parentNode.insertBefore(bar, inRow);
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1200);
})();
