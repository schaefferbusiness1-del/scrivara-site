/* feat_docselect_merge — MLS Easy: consolidate the doctor controls into ONE clean pill (2026-07-02).
   Before: a "Pulling as: [doctor] v" chip PLUS a separate "Find Doctors" button = clutter.
   After: one pill — the chip keeps its native provider dropdown, and a small "+ find a doctor"
   is folded INSIDE it (proxies the original Find Doctors, which stays functional but hidden).
   Pure DOM/CSS + click-proxy; never reimplements provider switching, so the Athena pull is safe. */
(function(){
  "use strict";
  if(window.__mlsDocMerge) return; window.__mlsDocMerge=true;

  function apply(){
    try{
      var chip=document.getElementById('mlsProvChip');
      var find=document.getElementById('mlsFindDocBtn');
      if(!chip) return;

      // Keep the real Find Doctors button in the DOM (its picker still works when clicked
      // programmatically) but hide it so there's only one visible control.
      if(find && find.style.display!=='none'){ find.style.display='none'; }

      // Make the chip read as one tidy pill.
      try{
        chip.style.display='inline-flex';
        chip.style.alignItems='center';
        chip.style.gap='2px';
        chip.style.cursor='pointer';
      }catch(e){}

      // Fold a compact "find a doctor" affordance INSIDE the chip (once).
      if(!chip.querySelector('#mlsFindInline')){
        var sep=document.createElement('span');
        sep.id='mlsFindInlineSep';
        sep.textContent='·';
        sep.style.cssText='margin:0 4px 0 8px;color:#9bb4d1';
        var b=document.createElement('span');
        b.id='mlsFindInline';
        b.textContent='🔍 find a doctor';
        b.title='Search all doctors in the practice';
        b.setAttribute('role','button');
        b.style.cssText='color:#2E6A4B;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap';
        b.addEventListener('click',function(e){
          e.preventDefault(); e.stopPropagation();
          var f=document.getElementById('mlsFindDocBtn');
          if(f){ try{ f.style.display=''; }catch(_){}
                 f.click();
                 try{ f.style.display='none'; }catch(_){}
          }
        });
        chip.appendChild(sep);
        chip.appendChild(b);
      }
    }catch(e){}
  }

  try{ new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(apply, 1500);
  if(document.readyState!=='loading') apply(); else document.addEventListener('DOMContentLoaded', apply);
})();
