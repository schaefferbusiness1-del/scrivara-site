/* feat_upload_templates — easy "Upload templates" button by the Prep-op-note action (item 14, 2026-07-02).
   Additive + safe: it only opens the app's EXISTING multi-file template picker (#tplMultiFileInput),
   so the app's own upload/processing handler runs. No data is deleted or changed. */
(function(){
  "use strict";
  if(window.__mlsUplTpl) return; window.__mlsUplTpl=true;

  function trigger(){
    var i=document.getElementById('tplMultiFileInput')||document.getElementById('tplFileInput');
    if(i){ try{ i.click(); }catch(e){} }
    else { alert('Open the Templates section to upload your templates.'); }
  }

  function makeBtn(){
    var b=document.createElement('button');
    b.type='button'; b.id='mlsUplTplBtn';
    b.textContent='📤 Upload templates';
    b.title='Add your own note templates (pick multiple files at once)';
    b.style.cssText='margin:10px 0 2px;display:inline-flex;align-items:center;gap:6px;background:#eef4fc;border:1px solid #cfe0f3;color:#15528f;border-radius:10px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;line-height:1.2';
    b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
    b.addEventListener('mouseleave',function(){ b.style.background='#eef4fc'; });
    b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); trigger(); });
    return b;
  }

  function findAnchor(){
    var els=document.querySelectorAll('button, a, div');
    for(var i=0;i<els.length;i++){
      var t=(els[i].innerText||'').trim();
      if(t && t.length<70 && /prep op note/i.test(t)) return els[i];
    }
    return null;
  }

  function inject(){
    try{
      if(document.getElementById('mlsUplTplBtn')) return;
      var anchor=findAnchor();
      if(!anchor) return;
      // climb to a card-sized ancestor so the button sits under the whole quick-action card
      var card=anchor;
      for(var k=0;k<3 && card.parentElement;k++){
        if(card.getBoundingClientRect().height>44) break;
        card=card.parentElement;
      }
      if(!card.parentNode) return;
      card.parentNode.insertBefore(makeBtn(), card.nextSibling);
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
  if(document.readyState!=='loading') inject(); else document.addEventListener('DOMContentLoaded', inject);
})();
