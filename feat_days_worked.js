/* feat_days_worked — "Days worked / patient volume" tool on the Analysis page (2026-07-03, Dad's request:
   "how some doctors get paid"). Adds a card to #analysisView; opens a monthly table showing DAYS WORKED
   (distinct appointment dates) and PATIENTS SEEN (distinct patients) per provider (separately) AND combined,
   computed client-side from window._calAppts. Fills in as more months are pulled from Athena. Read-only/safe. */
(function(){
  "use strict";
  if(window.__mlsDaysWorked) return; window.__mlsDaysWorked=true;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  function compute(){
    var a=(window._calAppts||[]).filter(function(x){ return x&&x.provider&&x.appt_date; });
    var months={}, provs={};
    a.forEach(function(x){
      var mo=String(x.appt_date).slice(0,7);
      var pr=x.provider; provs[pr]=1;
      var pat=x.patient_external_id||x.mrn||x.name||x.id||'?';
      months[mo]=months[mo]||{};
      months[mo][pr]=months[mo][pr]||{days:{},pats:{}};
      months[mo][pr].days[x.appt_date]=1; months[mo][pr].pats[pat]=1;
      months[mo].__all=months[mo].__all||{days:{},pats:{}};
      months[mo].__all.days[x.appt_date]=1; months[mo].__all.pats[pat]=1;
    });
    return { months:months, providers:Object.keys(provs).sort() };
  }
  function monthName(mo){ try{ return new Date(mo+'-01T12:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'}); }catch(e){ return mo; } }

  function openModal(){
    if(document.getElementById('mlsDWBack')) return;
    var c=compute(), provs=c.providers, months=Object.keys(c.months).sort().reverse();
    var back=document.createElement('div'); back.id='mlsDWBack';
    back.style.cssText='position:fixed;inset:0;background:rgba(10,30,60,.5);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:16px;max-width:860px;width:100%;max-height:86vh;overflow:auto;padding:22px;box-shadow:0 12px 44px rgba(0,0,0,.32)';
    var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-weight:800;font-size:18px;color:#204034">📊 Days worked / patient volume</div><button id="mlsDWClose" style="border:none;background:#eef4fc;color:#204034;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">Close</button></div>';
    h+='<div style="font-size:12.5px;color:#5b6b7c;margin-bottom:14px">Days worked = distinct appointment dates. Patients seen = distinct patients. Per provider and combined, by month. Pull past months from Athena to fill in history.</div>';
    if(!months.length){
      h+='<div style="padding:22px;text-align:center;color:#5b6b7c">No provider-linked appointment data yet.<br>Pull today’s / past months’ patients from Athena, then reopen this.</div>';
    } else {
      h+='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#204034"><th style="padding:6px 8px;border-bottom:2px solid #E7E5DD">Month</th>';
      provs.forEach(function(p){ h+='<th style="padding:6px 8px;border-bottom:2px solid #E7E5DD" colspan="2">'+esc(p)+'</th>'; });
      h+='<th style="padding:6px 8px;border-bottom:2px solid #E7E5DD" colspan="2">Combined</th></tr>';
      h+='<tr style="text-align:left;color:#5b6b7c;font-size:11px"><th></th>';
      provs.forEach(function(){ h+='<th style="padding:2px 8px">Days</th><th style="padding:2px 8px">Patients</th>'; });
      h+='<th style="padding:2px 8px">Days</th><th style="padding:2px 8px">Patients</th></tr></thead><tbody>';
      months.forEach(function(mo){
        h+='<tr><td style="padding:6px 8px;border-bottom:1px solid #F4F2EC;font-weight:700">'+esc(monthName(mo))+'</td>';
        provs.forEach(function(p){ var d=c.months[mo][p]; h+='<td style="padding:6px 8px;border-bottom:1px solid #F4F2EC">'+(d?Object.keys(d.days).length:0)+'</td><td style="padding:6px 8px;border-bottom:1px solid #F4F2EC">'+(d?Object.keys(d.pats).length:0)+'</td>'; });
        var all=c.months[mo].__all;
        h+='<td style="padding:6px 8px;border-bottom:1px solid #F4F2EC;font-weight:700">'+(all?Object.keys(all.days).length:0)+'</td><td style="padding:6px 8px;border-bottom:1px solid #F4F2EC;font-weight:700">'+(all?Object.keys(all.pats).length:0)+'</td></tr>';
      });
      h+='</tbody></table>';
    }
    box.innerHTML=h; back.appendChild(box); document.body.appendChild(back);
    function close(){ var b=document.getElementById('mlsDWBack'); if(b) b.remove(); }
    box.querySelector('#mlsDWClose').onclick=close;
    back.addEventListener('click',function(e){ if(e.target===back) close(); });
  }

  function inject(){
    try{
      var grid=document.getElementById('analysisView');
      if(!grid) return;
      if(grid.getBoundingClientRect().width < 5) return;   // only when Analysis view is visible
      if(document.getElementById('mlsDWCard')) return;
      var model=[].slice.call(grid.children).filter(function(c){ return /(^|\s)card(\s|$)/.test((c.className||'').toString()); })[0];
      var card = (model && model.cloneNode) ? model.cloneNode(false) : document.createElement('div');
      if(!card.className) card.className='card';
      card.id='mlsDWCard';
      card.innerHTML='<div style="font-weight:800;color:#204034;font-size:14px">📊 Days worked/patient volume</div><div style="font-size:12px;color:#5b6b7c;margin:6px 0 10px">Days worked &amp; patients seen per provider, by month — separately &amp; combined.</div><button id="mlsDWOpen" type="button" style="border:none;background:#2E6A4B;color:#fff;border-radius:8px;padding:7px 13px;font-weight:700;cursor:pointer;font-family:inherit">Open</button>';
      card.querySelector('#mlsDWOpen').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); openModal(); });
      grid.appendChild(card);
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
})();
