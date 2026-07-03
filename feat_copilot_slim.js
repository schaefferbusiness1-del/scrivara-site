/* feat_copilot_slim — make the Copilot fast + focused (2026-07-03).
   The Copilot was sending ~424 KB every message (all 654 patients in full + every appointment,
   including the stale null-provider junk) — big enough to overflow the model's context window and
   slow every reply. This wraps fetch and, ONLY for /api/copilot, keeps the ACTIVE patient in full,
   compacts the other patients to essentials (still enough for "show me all my X patients"), and
   drops the stale null-provider appointments. Anything unexpected → pass the original body through
   unchanged (safe). Never touches non-copilot requests. */
(function(){
  "use strict";
  if(window.__mlsCopilotSlim) return; window.__mlsCopilotSlim=true;

  var origFetch = window.fetch;
  if(typeof origFetch !== 'function') return;

  function compactPatient(p){
    if(!p || typeof p !== 'object') return p;
    // keep identity + the fields that power practice-wide questions; drop the bulky history/visits/notes
    return {
      name: p.name, dob: p.dob, sex: p.sex, mrn: p.mrn,
      problems: p.problems, medications: p.medications || p.meds, allergies: p.allergies
    };
  }

  function slim(bodyStr){
    try{
      if(typeof bodyStr !== 'string' || bodyStr.length < 20000) return null; // only bother with big payloads
      var j = JSON.parse(bodyStr);
      if(!j || !j.context || typeof j.context !== 'object') return null;
      var ctx = j.context;
      var activeName = (ctx.activePatient && ctx.activePatient.name) || null;

      if(Array.isArray(ctx.patients)){
        ctx.patients = ctx.patients.map(function(p){
          // keep the ACTIVE patient in full; compact everyone else
          if(activeName && p && p.name === activeName) return p;
          return compactPatient(p);
        });
      }
      // ensure the active patient is present in full even if not in the list
      if(ctx.activePatient && typeof ctx.activePatient === 'object'){ /* left as-is (full) */ }

      // drop stale/junk appointments (no provider = old buggy scrape with wrong AM times)
      if(Array.isArray(ctx.appointments)){
        ctx.appointments = ctx.appointments.filter(function(a){ return a && a.provider; });
      }

      var out = JSON.stringify(j);
      // only use it if it actually got smaller and still parses
      if(out && out.length < bodyStr.length) return out;
      return null;
    }catch(e){ return null; }
  }

  window.fetch = function(input, init){
    try{
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if(url.indexOf('/api/copilot') >= 0 && init && typeof init.body === 'string'){
        var slimmed = slim(init.body);
        if(slimmed){
          var ni = {}; for(var k in init){ if(Object.prototype.hasOwnProperty.call(init,k)) ni[k]=init[k]; }
          ni.body = slimmed;
          return origFetch.call(this, input, ni);
        }
      }
    }catch(e){}
    return origFetch.apply(this, arguments);
  };
})();
