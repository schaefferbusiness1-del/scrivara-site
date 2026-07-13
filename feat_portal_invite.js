/* feat_portal_invite — doctor "Send portal login" button on the active patient (2026-07-02).
   Self-contained IIFE. Adds a pill button next to the active-patient chip; clicking opens a
   small in-app popup to email the patient a one-time secure portal login. Reuses the app's
   own MLS session token (localStorage sf_bk_token). No page navigation. */
(function(){
  "use strict";
  if(window.__mlsPortalInvite) return; window.__mlsPortalInvite=true;
  var API="https://scrivara-backend.onrender.com";

  function tok(){ try{ return localStorage.getItem('sf_bk_token'); }catch(e){ return null; } }
  function active(){ try{ var ap=window.activePatient; if(typeof ap==='function') ap=ap(); return (ap&&typeof ap==='object')?ap:null; }catch(e){ return null; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function findEmail(ap){
    try{
      if(!ap) return '';
      if(ap.email) return ap.email;
      var list=(typeof window.getPatients==='function')?window.getPatients():null;
      if(Array.isArray(list)){
        var m=list.filter(function(p){ return p && (p.id===ap.id || (p.name===ap.name && p.dob===ap.dob)); })[0];
        if(m && m.email) return m.email;
      }
    }catch(e){}
    return '';
  }

  function openModal(ap){
    if(document.getElementById('mlsPiBack')) return;
    var email=findEmail(ap), nm=(ap&&ap.name)||'this patient';
    var back=document.createElement('div');
    back.id='mlsPiBack';
    back.style.cssText='position:fixed;inset:0;background:rgba(10,30,60,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px;box-shadow:0 12px 44px rgba(0,0,0,.32)';
    box.innerHTML=''
      +'<div style="font-weight:800;font-size:17px;color:#15528f;margin-bottom:4px">📧 Send portal login</div>'
      +'<div style="font-size:13.5px;color:#5b6b7c;margin-bottom:14px">'+esc(nm)+' will get a secure email with a one-time link to view their records and chat with them.</div>'
      +'<label style="display:block;font-size:12.5px;font-weight:700;color:#15528f;margin-bottom:5px">Patient email</label>'
      +'<input id="mlsPiEmail" type="email" value="'+esc(email)+'" placeholder="patient@email.com" style="width:100%;padding:11px 12px;border:1px solid #E7E5DD;border-radius:10px;font-size:15px;box-sizing:border-box;color:#0d2338" />'
      +'<div id="mlsPiMsg" style="font-size:13px;margin-top:12px;display:none"></div>'
      +'<div style="display:flex;gap:8px;margin-top:18px">'
      +'  <button id="mlsPiCancel" type="button" style="flex:1;padding:11px;border:1px solid #E7E5DD;background:#eef4fc;color:#15528f;border-radius:10px;font-weight:700;cursor:pointer">Cancel</button>'
      +'  <button id="mlsPiSend" type="button" style="flex:2;padding:11px;border:none;background:#2E6A4B;color:#fff;border-radius:10px;font-weight:700;cursor:pointer">Send login</button>'
      +'</div>';
    back.appendChild(box); document.body.appendChild(back);
    var msg=box.querySelector('#mlsPiMsg');
    function showMsg(t,ok){ msg.style.display='block'; msg.textContent=t; msg.style.color=ok?'#0f6b49':'#a12626'; }
    function close(){ var b=document.getElementById('mlsPiBack'); if(b) b.remove(); }
    box.querySelector('#mlsPiCancel').onclick=close;
    back.addEventListener('click',function(e){ if(e.target===back) close(); });
    box.querySelector('#mlsPiSend').onclick=function(){
      var em=(box.querySelector('#mlsPiEmail').value||'').trim();
      if(!em){ showMsg('Please enter the patient’s email.',false); return; }
      var tk=tok();
      if(!tk){ showMsg('You’re signed out — sign back into MLS and try again.',false); return; }
      var btn=box.querySelector('#mlsPiSend'); btn.disabled=true; var old=btn.textContent; btn.textContent='Sending…';
      var body={ email:em, name:(ap&&ap.name)||'', dob:(ap&&ap.dob)||'', external_id:(ap&&ap.id)||'', mrn:(ap&&(ap.mrn||ap.id))||'' };
      fetch(API+'/api/patient/admin/send-portal-invite',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tk},body:JSON.stringify(body)})
        .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ return {ok:r.ok,status:r.status,j:j}; }); })
        .then(function(res){
          if(res.ok){ showMsg('✓ Portal login sent to '+em+'.',true); setTimeout(close,1900); }
          else if(res.status===401||res.status===403){ showMsg('This account isn’t authorized to send invites (needs admin). Ask the owner to send it.',false); }
          else { showMsg((res.j&&(res.j.error||res.j.message))||('Could not send (error '+res.status+').'),false); }
        })
        .catch(function(){ showMsg('Network error — please try again.',false); })
        .then(function(){ btn.disabled=false; btn.textContent=old; });
    };
  }

  function makeBtn(){
    var b=document.createElement('button');
    b.id='mlsPortalInviteBtn'; b.type='button';
    b.textContent='📧 Send portal login';
    b.title='Email this patient a secure link to their records';
    b.style.cssText='margin:6px 8px 2px 0;display:inline-flex;align-items:center;gap:6px;background:#eef4fc;border:1px solid #cfe0f3;color:#15528f;border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;line-height:1.2';
    b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
    b.addEventListener('mouseleave',function(){ b.style.background='#eef4fc'; });
    b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); var ap=active(); if(!ap){ alert('Select a patient first.'); return; } openModal(ap); });
    return b;
  }

  function inject(){
    try{
      if(document.getElementById('mlsPortalInviteBtn')) return;
      if(!active()) return; // only show when a patient is selected
      var host=document.querySelector('.mlsctx-id')||document.querySelector('.mlsctx-idtext')||document.querySelector('#visitHero');
      var hero=document.getElementById('heroPtName');
      var b=makeBtn();
      if(host){
        var meta=host.querySelector('.mlsctx-meta');
        if(meta && meta.parentNode){ meta.parentNode.insertBefore(b, meta.nextSibling); }
        else { host.appendChild(b); }
      } else if(hero && hero.parentNode){
        hero.parentNode.insertBefore(b, hero.nextSibling);
      } else { return; }
    }catch(e){}
  }

  try{ new MutationObserver(function(){ inject(); }).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
  if(document.readyState!=='loading') inject(); else document.addEventListener('DOMContentLoaded', inject);
})();
