/* feat_delall_guard — strong "type DELETE" confirmation on the Delete-ALL-templates button (item 18, 2026-07-03).
   Intercepts clicks on the delete-all-templates control, blocks the immediate wipe, and requires the user to
   type DELETE. Only then does it clear via the app's own setTemplates([]) + renderTemplateList(). Protects the
   doctor's uploaded templates from an accidental one-click wipe. */
(function(){
  "use strict";
  if(window.__mlsDelGuard) return; window.__mlsDelGuard=true;

  function isDelAll(el){
    var n=0;
    while(el && el.nodeType===1 && n<5){
      if(el.id==='mlsP1DelAll') return el;
      if(el.tagName==='BUTTON'){
        var t=(el.textContent||'').toLowerCase();
        if(t.indexOf('delete')>=0 && t.indexOf('template')>=0 && (t.indexOf('all')>=0 || t.indexOf('every')>=0)) return el;
      }
      el=el.parentElement; n++;
    }
    return null;
  }

  document.addEventListener('click', function(e){
    var btn=isDelAll(e.target);
    if(!btn) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openModal();
  }, true);

  function count(){ try{ return (typeof window.getTemplates==='function') ? (window.getTemplates()||[]).length : null; }catch(e){ return null; } }

  function doDelete(){
    var ok=false;
    try{ if(typeof window.setTemplates==='function'){ window.setTemplates([]); ok=true; } }catch(e){}
    try{ if(typeof window.renderTemplateList==='function') window.renderTemplateList(); }catch(e){}
    // verify + last-resort fallback on the known storage keys (per-user + shared)
    var left=count();
    if(left && left>0){
      try{
        localStorage.removeItem('mls_playbooks');
        for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && /::templates$/.test(k)) localStorage.removeItem(k); }
        if(typeof window.renderTemplateList==='function') window.renderTemplateList();
        ok=true;
      }catch(e){}
    }
    return count()===0 || ok;
  }

  function openModal(){
    if(document.getElementById('mlsDelBack')) return;
    var n=count();
    var back=document.createElement('div');
    back.id='mlsDelBack';
    back.style.cssText='position:fixed;inset:0;background:rgba(10,30,60,.5);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:16px;max-width:430px;width:100%;padding:22px;box-shadow:0 12px 44px rgba(0,0,0,.32)';
    box.innerHTML=''
      +'<div style="font-weight:800;font-size:17px;color:#a12626;margin-bottom:6px">🗑 Delete all templates?</div>'
      +'<div style="font-size:13.5px;color:#5b6b7c;margin-bottom:14px">This permanently removes <b>'+(n==null?'all':n)+'</b> template'+(n===1?'':'s')+'. This cannot be undone. Type <b>DELETE</b> to confirm.</div>'
      +'<input id="mlsDelInput" type="text" placeholder="Type DELETE" autocomplete="off" style="width:100%;padding:11px 12px;border:1px solid #E7E5DD;border-radius:10px;font-size:15px;box-sizing:border-box;letter-spacing:1px" />'
      +'<div id="mlsDelMsg" style="font-size:13px;margin-top:12px;display:none;color:#0f6b49"></div>'
      +'<div style="display:flex;gap:8px;margin-top:18px">'
      +'  <button id="mlsDelCancel" type="button" style="flex:1;padding:11px;border:1px solid #E7E5DD;background:#eef4fc;color:#204034;border-radius:10px;font-weight:700;cursor:pointer">Cancel</button>'
      +'  <button id="mlsDelGo" type="button" disabled style="flex:1;padding:11px;border:none;background:#d9534f;color:#fff;border-radius:10px;font-weight:700;cursor:pointer;opacity:.5">Delete all</button>'
      +'</div>';
    back.appendChild(box); document.body.appendChild(back);
    var input=box.querySelector('#mlsDelInput');
    var go=box.querySelector('#mlsDelGo');
    var msg=box.querySelector('#mlsDelMsg');
    function close(){ var b=document.getElementById('mlsDelBack'); if(b) b.remove(); }
    input.addEventListener('input', function(){
      var ok=input.value.trim().toUpperCase()==='DELETE';
      go.disabled=!ok; go.style.opacity=ok?'1':'.5';
    });
    box.querySelector('#mlsDelCancel').onclick=close;
    back.addEventListener('click', function(e){ if(e.target===back) close(); });
    go.onclick=function(){
      if(input.value.trim().toUpperCase()!=='DELETE') return;
      go.disabled=true; go.textContent='Deleting…';
      var ok=doDelete();
      msg.style.display='block';
      if(ok){ msg.style.color='#0f6b49'; msg.textContent='✓ All templates deleted.'; setTimeout(close,1400); }
      else { msg.style.color='#a12626'; msg.textContent='Could not delete — please try again.'; go.disabled=false; go.textContent='Delete all'; }
    };
    setTimeout(function(){ try{ input.focus(); }catch(e){} }, 50);
  }
})();
