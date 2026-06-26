;(function(){
  "use strict";
  /* item33 — MLSscribe unification: the Patients list (#ptList) renders each
     row's most-recent-visit date as a bare "Seen M/D/YYYY" chip (numeric,
     "Seen" prefix), while every other surface that shows the SAME concept —
     the patient context bar (item32), the Patients profile chips, and the
     patient quick-history popover — phrases it as "last seen <Mon D, YYYY>"
     (lowercase "last seen", spelled-short-month date). The app's canonical
     builder is: chip('last seen', d.toLocaleDateString([], {month:'short',
     day:'numeric', year:'numeric'})). This module reformats the date string
     ALREADY shown on each list row to that exact canonical form, so a
     patient's last-visit date is phrased and formatted identically
     everywhere. Display-only: it only re-renders text the row already shows
     (it never recomputes from records, never touches/deletes/mutates any
     patient data), additive, reversible, no storage, no network.
     Revert: window.__mlsLastSeenRows.revert(). */
  try{
    if (window.__mlsLastSeenRows && window.__mlsLastSeenRows.__installed) return;
  }catch(e){ return; }

  // Matches the holdout chip text exactly: "Seen 6/24/2026" (optional surrounding ws)
  var RX = /^(\s*)Seen\s+(\d{1,2})\/(\d{1,2})\/(\d{4})(\s*)$/;
  var modified = [];   // span elements we touched (originals stashed on the node)
  var obs = null;

  function fmtCanonical(mm, dd, yyyy){
    try{
      var d = new Date(yyyy, mm - 1, dd);
      if (isNaN(d.getTime())) return null;
      // Identical options to the app's canonical "last seen" chip builder.
      return 'last seen ' + d.toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'});
    }catch(e){ return null; }
  }

  function applyTo(el){
    try{
      if (!el || el.nodeType !== 1) return;
      if (el.children && el.children.length) return;        // leaf text node only
      if (!el.closest || !el.closest('#ptList')) return;    // scope: Patients list rows only
      var cur = el.textContent;
      if (!cur || cur.indexOf('Seen') < 0) return;
      var m = RX.exec(cur);
      if (!m) return;
      var next = fmtCanonical(+m[2], +m[3], +m[4]);
      if (!next || next === cur) return;
      if (el.__mlsLSRorig == null) el.__mlsLSRorig = cur;
      el.textContent = next;
      if (modified.indexOf(el) < 0) modified.push(el);
    }catch(e){}
  }

  function scan(){
    try{
      var host = document.getElementById('ptList');
      if (!host) return;
      var els = host.querySelectorAll('span');
      for (var i = 0; i < els.length; i++) applyTo(els[i]);
    }catch(e){}
  }

  function onMut(muts){
    for (var i = 0; i < muts.length; i++){
      var mu = muts[i];
      if (mu.type === 'characterData'){
        var p = mu.target && mu.target.parentElement;
        if (p && p.tagName === 'SPAN') applyTo(p);
      } else if (mu.addedNodes){
        for (var j = 0; j < mu.addedNodes.length; j++){
          var n = mu.addedNodes[j];
          if (!n || n.nodeType !== 1) continue;
          if (n.tagName === 'SPAN') applyTo(n);
          if (n.querySelectorAll){
            var ss = n.querySelectorAll('span');
            for (var k = 0; k < ss.length; k++) applyTo(ss[k]);
          }
        }
      }
    }
  }

  function start(){
    try{
      scan();
      obs = new MutationObserver(onMut);
      obs.observe(document.documentElement, {childList:true, subtree:true, characterData:true});
    }catch(e){}
  }

  window.__mlsLastSeenRows = {
    __installed: true,
    count: function(){ return modified.length; },
    rescan: function(){ scan(); return modified.length; },
    revert: function(){
      try{ if (obs){ obs.disconnect(); obs = null; } }catch(e){}
      for (var i = 0; i < modified.length; i++){
        try{
          var el = modified[i];
          if (el && el.__mlsLSRorig != null){
            el.textContent = el.__mlsLSRorig;
            el.__mlsLSRorig = null;
          }
        }catch(e){}
      }
      modified = [];
      this.__installed = false;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
