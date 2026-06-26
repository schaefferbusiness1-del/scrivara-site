;(function(){
  "use strict";
  /* item32 — MLSscribe unification: the patient context-bar (top identity strip)
     labels the most-recent-visit date as "· last <date>", while every other
     surface that shows the same concept — the pinned patient-face quick-history
     popover, the Patients profile chips, and the patient quick-history card —
     says "last seen <date>". This module unifies the context bar to read
     "last seen <date>" too, so the patient's last-visit date is phrased the
     same everywhere. Display-only, additive, reversible. No patient data,
     no storage, no network. Revert: window.__mlsLastSeenUnify.revert(). */
  try{
    if (window.__mlsLastSeenUnify && window.__mlsLastSeenUnify.__installed) return;
  }catch(e){ return; }

  var SEL = '.mlsctx-meta';
  var modified = [];           // elements we touched + their original text
  var wrapped  = [];           // wrapped refresh fns, for clean revert
  var obs = null;

  function normText(t){
    if (typeof t !== 'string') return t;
    // Only the context-bar last-visit token: "· last <date>" -> "· last seen <date>".
    return t.replace(/(·\s*)last\s+(?!seen\b)/i, '$1last seen ');
  }

  function applyTo(el){
    try{
      if (!el || el.nodeType !== 1) return;
      if (el.children && el.children.length) return;      // plain-text meta only
      var cur = el.textContent;
      if (!cur || cur.indexOf('last') < 0) return;
      if (/·\s*last\s+seen\b/i.test(cur)) return;     // already unified
      var next = normText(cur);
      if (next !== cur){
        if (el.__mlsLSorig == null) el.__mlsLSorig = cur;
        el.textContent = next;
        if (modified.indexOf(el) < 0) modified.push(el);
      }
    }catch(e){}
  }

  function sweep(root){
    try{
      var scope = (root && root.querySelectorAll) ? root : document;
      var els = scope.querySelectorAll(SEL);
      for (var i=0;i<els.length;i++) applyTo(els[i]);
      if (root && root.nodeType===1 && root.classList && root.classList.contains('mlsctx-meta')) applyTo(root);
    }catch(e){}
  }

  function wrapRefresh(obj, name){
    try{
      if (!obj || typeof obj[name] !== 'function') return;
      if (obj[name].__mlsLSwrapped) return;
      var orig = obj[name];
      function w(){
        var r;
        try{ r = orig.apply(this, arguments); }catch(e){ r = undefined; }
        try{ setTimeout(function(){ sweep(document); }, 0); }catch(e){}
        return r;
      }
      w.__mlsLSwrapped = true;
      obj[name] = w;
      wrapped.push({obj:obj, name:name, orig:orig});
    }catch(e){}
  }

  function wrapAll(){
    try{ wrapRefresh(window.__mlsCtxBar, 'refresh'); }catch(e){}
    try{ if (window.__mlsCard && window.__mlsCard !== window.__mlsCtxBar) wrapRefresh(window.__mlsCard, 'refresh'); }catch(e){}
  }

  function startObs(){
    try{
      if (obs || !window.MutationObserver || !document.body) return;
      obs = new MutationObserver(function(muts){
        for (var i=0;i<muts.length;i++){
          var added = muts[i].addedNodes;
          if (!added) continue;
          for (var j=0;j<added.length;j++){
            var n = added[j];
            if (n && n.nodeType===1) sweep(n);
          }
        }
      });
      obs.observe(document.body, {childList:true, subtree:true});
    }catch(e){}
  }

  function init(){
    wrapAll();
    startObs();
    sweep(document);
    [200, 600, 1500].forEach(function(ms){ try{ setTimeout(function(){ wrapAll(); sweep(document); }, ms); }catch(e){} });
  }

  window.__mlsLastSeenUnify = {
    __installed: true,
    resweep: function(){ sweep(document); },
    revert: function(){
      try{ if (obs){ obs.disconnect(); obs = null; } }catch(e){}
      try{
        wrapped.forEach(function(w){
          try{ if (w.obj && w.obj[w.name] && w.obj[w.name].__mlsLSwrapped) w.obj[w.name] = w.orig; }catch(e){}
        });
        wrapped.length = 0;
      }catch(e){}
      try{
        modified.forEach(function(el){
          try{ if (el.__mlsLSorig != null){ el.textContent = el.__mlsLSorig; el.__mlsLSorig = null; } }catch(e){}
        });
        modified.length = 0;
      }catch(e){}
      this.__installed = false;
      return true;
    }
  };

  try{
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }catch(e){}
})();
