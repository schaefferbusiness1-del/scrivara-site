/* feat_mls_task7_analysis_sg.js — Task 7: Analysis dashboard + Study Groups fix pack
 * Additive + reversible. Revert: window.__mlsT7.revert()
 *
 * ANALYSIS FIXES
 *  A1 grid: auto row heights (kills the ~200px blank band under the "Analysis" title,
 *     kills dead white space inside expanded cards), row flow instead of dense
 *     (cards keep their order — no more jumping when one expands)
 *  A2 collapsed-face stats: "Key trends" face showed the top-dx count (57) labeled as
 *     active patients — a hidden label-anchored hint now feeds the ax module's own
 *     extraction the real count; the custom-widget card gets a real title
 *     (no more "Untitled" tile)
 *  A3 "data as of h:mm" stamp + "Refresh data" button in the Analysis title row;
 *     localStorage data-change hook flips the stamp to "data changed — refresh to
 *     update" so stale values are visible instead of silent
 *  A4 heavy tiles (expand) and heavy Study-Group buttons paint a "Working…" overlay
 *     BEFORE the app's synchronous compute starts, so the page never looks dead
 *
 * STUDY GROUPS FIXES (AI Studio card — keeps the shipped engine, fixes the UX)
 *  S1 "v1 · staging" badge removed from prod UI
 *  S2 select no longer silently resets to the first group after actions
 *     (root cause of patients landing in the WRONG group) + stale athena status
 *     cleared when switching groups
 *  S3 validation: patient name required (real letters), DOB must be a real date
 *     (YYYY-MM-DD), garbage CSV rows are rejected with an honest per-row report
 *     and an "Import N valid rows" option; bad JSON gets an inline error
 *  S4 alert() calls from the module are routed to an inline status line while a
 *     Study-Groups action is in flight (no more blocking popups)
 *  S5 per-patient ✕ remove (with inline confirm) — was impossible before
 *  S6 ✎ rename group
 *  S7 "Run study" on an empty group is blocked with an honest empty-state message
 *  S8 elapsed-time counter + honest hint during the (slow) athena read-only pull
 *  S9 two-column layout on wide screens (fills the dead right half), 1-col on mobile
 *
 * v1.0.2: single validation-first capture router (validation can no longer be
 * bypassed by the busy-overlay path), setTimeout-based deferral instead of rAF
 * (rAF never fires in occluded/throttled tabs, which silently swallowed clicks).
 */
;(function () {
  "use strict";
  if (window.__mlsT7 && window.__mlsT7.__live) return;
  var VER = "t7-1.0.2";
  var cleanup = [];            // fns to run on revert
  function onRevert(f){ cleanup.push(f); }
  function $(id){ try { return document.getElementById(id); } catch(e){ return null; } }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function now(){ var d=new Date(),h=d.getHours(),m=("0"+d.getMinutes()).slice(-2),ap=h>=12?"PM":"AM";h=h%12||12;return h+":"+m+" "+ap; }
  function deb(fn,ms){ var t=null; return function(){ if(t)clearTimeout(t); t=setTimeout(fn,ms); }; }

  /* ============================ CSS ============================ */
  var css = [
    "#analysisView.ax-grid{grid-auto-rows:auto!important;grid-auto-flow:row!important}",
    "#analysisView.ax-grid .ax-title{margin:2px 0 6px!important}",
    "#analysisView.ax-grid .ax-title h1{margin-bottom:2px}",
    "#analysisView.ax-grid .ax-tile{min-height:212px}",
    "#analysisView.ax-grid .ax-tile.ax-exp{min-height:280px}",
    "#analysisView.ax-grid .ax-tile.ax-exp .ax-body>.card{height:auto!important;max-height:74vh;overflow:auto}",
    "#t7AxBar{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap}",
    "#t7AxStamp{font-size:12px;color:#8b9bb0}",
    "#t7AxStamp.t7-dirty{color:#b26a00;font-weight:600}",
    "#t7AxRefresh{height:30px;padding:0 12px;border-radius:8px;border:1px solid #dbe4ee;background:#fff;color:#2E6A4B;font-weight:600;font-size:12.5px;cursor:pointer;font-family:inherit}",
    "#t7AxRefresh:hover{background:#f3f7ff}",
    "#t7AxRefresh[disabled]{opacity:.55;cursor:default}",
    ".t7-face-note{color:#A6AEA6;font-size:11px;margin-top:4px}",
    ".t7-busy{position:absolute;inset:0;background:rgba(255,255,255,.72);display:flex;align-items:center;justify-content:center;z-index:40;border-radius:inherit;backdrop-filter:blur(1px)}",
    ".t7-busy>div{display:flex;align-items:center;gap:10px;color:#204034;font-weight:600;font-size:13.5px;background:#fff;border:1px solid #e2e9f2;border-radius:12px;padding:10px 16px;box-shadow:0 8px 24px -12px rgba(20,33,28,.35)}",
    ".t7-spin{width:16px;height:16px;border-radius:50%;border:2px solid #c9d9ef;border-top-color:#2E6A4B;animation:t7spin .8s linear infinite}",
    "@keyframes t7spin{to{transform:rotate(360deg)}}",
    "@media(min-width:1150px){#mls-sg-root{display:grid!important;grid-template-columns:1fr 1fr;gap:0 16px;align-items:start;max-width:1320px}",
    " #mls-sg-root>.mls-sg-card:nth-child(1){grid-column:1/-1}",
    " #mls-sg-root>.mls-sg-card:nth-child(2){grid-column:1;margin-top:0}",
    " #mls-sg-root>.mls-sg-card:nth-child(3){grid-column:2;margin-top:0;position:sticky;top:70px}}",
    "@media(max-width:819px){#mls-sg-root .mls-sg-row{flex-wrap:wrap}#mls-sg-root input,#mls-sg-root select{min-width:0}}",
    "#t7SgStatus{display:none;margin:8px 0 2px;padding:8px 12px;border-radius:9px;font-size:12.5px;font-weight:600;line-height:1.45}",
    "#t7SgStatus.t7-ok{display:block;background:#eef8f1;color:#1f7d5c;border:1px solid #cdeadb}",
    "#t7SgStatus.t7-err{display:block;background:#fdf0ef;color:#b3382c;border:1px solid #f3d5d2}",
    "#t7SgStatus.t7-info{display:block;background:#eef4fd;color:#2E6A4B;border:1px solid #d5e3f7}",
    "#t7SgStatus button{margin-left:8px;height:24px;padding:0 10px;border-radius:7px;border:1px solid currentColor;background:transparent;color:inherit;font-weight:700;font-size:11.5px;cursor:pointer;font-family:inherit}",
    ".t7-rm{margin-left:10px;border:none;background:transparent;color:#c05248;font-weight:700;cursor:pointer;font-size:13px;line-height:1;padding:2px 6px;border-radius:6px}",
    ".t7-rm:hover{background:#fdeeed}",
    "#t7SgRename{height:28px;padding:0 9px;border-radius:7px;border:1px solid #dbe4ee;background:#fff;color:#5c6f87;font-size:12px;cursor:pointer;font-family:inherit}",
    "#t7SgRename:hover{color:#2E6A4B;border-color:#EAF1EE}"
  ].join("\n");
  var styleEl = document.createElement("style");
  styleEl.id = "t7Style";
  (document.head || document.documentElement).appendChild(styleEl);
  styleEl.textContent = css;
  onRevert(function(){ try{ styleEl.remove(); }catch(e){} });

  /* ====================== busy overlay ====================== */
  function busyOn(host, label){
    try {
      if (!host) return null;
      var o = document.createElement("div");
      o.className = "t7-busy";
      o.innerHTML = '<div><span class="t7-spin"></span>' + esc(label || "Working…") + "</div>";
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(o);
      void o.getBoundingClientRect(); // commit before heavy sync work
      return o;
    } catch(e){ return null; }
  }
  function busyOff(o){ try{ if(o) o.remove(); }catch(e){} }

  /* ================= analysis faces + refresh ================= */
  var lastStamp = null;
  function fixFaces(){
    try {
      var av = $("analysisView"); if (!av) return;
      var body = $("anaKeyTrendsBody");
      if (body) {
        var n = null;
        var labels = body.querySelectorAll("div,span,b,strong");
        for (var i=0;i<labels.length;i++){
          if (/^Active patients$/i.test((labels[i].textContent||"").trim())) {
            var box = labels[i].parentElement;
            var cand = box && box.querySelectorAll("*");
            for (var j=0;cand && j<cand.length;j++){
              var tv = (cand[j].textContent||"").trim();
              if (/^[\d,]+$/.test(tv) && cand[j] !== labels[i]) { n = tv; break; }
            }
            break;
          }
        }
        if (n) {
          var hint = $("t7KtHint"), was = hint ? hint.textContent : null;
          if (!hint) {
            hint = document.createElement("span");
            hint.id = "t7KtHint"; hint.style.display = "none";
            body.insertBefore(hint, body.firstChild);
          }
          var want = n + " active patients";
          if (hint.textContent !== want) hint.textContent = want;
          if (was === null && window.__mlsAx && window.__mlsAx.build) setTimeout(function(){ try{ window.__mlsAx.build(); }catch(e){} }, 250);
        }
      }
      var dw = $("mlsDWCard");
      if (dw && !dw.querySelector("h1,h2,h3")) {
        var h3 = document.createElement("h3");
        h3.style.display = "none";
        h3.textContent = "Days worked & patient volume";
        dw.insertBefore(h3, dw.firstChild);
        if (window.__mlsAx && window.__mlsAx.build) setTimeout(function(){ try{ window.__mlsAx.build(); }catch(e){} }, 250);
      }
      if (lastStamp) {
        av.querySelectorAll(".ax-tile").forEach(function(tile){
          if (tile.classList.contains("ax-exp")) return;
          var chip = tile.querySelector(":scope > .t7-face-note");
          if (!chip) {
            chip = document.createElement("div");
            chip.className = "t7-face-note";
            chip.style.cssText = "position:absolute;left:20px;bottom:8px;pointer-events:none;z-index:4";
            tile.appendChild(chip);
          }
          var want2 = "as of " + lastStamp;
          if (chip.textContent !== want2) chip.textContent = want2;
        });
      }
    } catch(e){}
  }

  function ensureAxBar(){
    try {
      var av = $("analysisView"); if (!av) return;
      var title = av.querySelector(".ax-title"); if (!title || $("t7AxBar")) return;
      var bar = document.createElement("div");
      bar.id = "t7AxBar";
      bar.innerHTML = '<button id="t7AxRefresh" type="button">&#8635; Refresh data</button><span id="t7AxStamp"></span>';
      title.appendChild(bar);
      $("t7AxRefresh").addEventListener("click", function(){
        var btn = $("t7AxRefresh"); btn.disabled = true; btn.textContent = "Refreshing…";
        setTimeout(function(){
          try {
            var nav = $("nav_analysis"); if (nav) nav.click();      // app rebuilds card contents on tab open
            if (window.__mlsAx && window.__mlsAx.build) window.__mlsAx.build();
          } catch(e){}
          setTimeout(function(){
            stamp(false); fixFaces();
            btn.disabled = false; btn.innerHTML = "&#8635; Refresh data";
          }, 250);
        }, 30);
      });
      stamp(false);
    } catch(e){}
  }
  function stamp(dirty){
    lastStamp = now();
    var s = $("t7AxStamp"); if (!s) return;
    if (dirty) { s.className = "t7-dirty"; s.textContent = "data changed — refresh to update"; }
    else { s.className = ""; s.textContent = "data as of " + lastStamp; }
  }

  /* data-change hook: surface staleness the moment stored data changes */
  var origSetItem = null;
  try {
    origSetItem = Storage.prototype.setItem;
    var markDirty = deb(function(){
      try {
        var av = $("analysisView");
        if (av && av.style.display !== "none") { stamp(true); }
        else { lastStamp = null; } /* re-stamps fresh next time faces build */
      } catch(e){}
    }, 900);
    Storage.prototype.setItem = function(k, v){
      var r = origSetItem.apply(this, arguments);
      try { if (/::patients$|::notes$|mlsNoteVisits/.test(String(k))) markDirty(); } catch(e){}
      return r;
    };
    onRevert(function(){ try{ Storage.prototype.setItem = origSetItem; }catch(e){} });
  } catch(e){}

  /* re-run face polish after the ax module rebuilds */
  if (window.__mlsAx && typeof window.__mlsAx.build === "function" && !window.__mlsAx.__t7wrap) {
    var ob = window.__mlsAx.build;
    window.__mlsAx.build = function(){ var r = ob.apply(this, arguments); try{ ensureAxBar(); fixFaces(); }catch(e){} return r; };
    window.__mlsAx.__t7wrap = true;
    onRevert(function(){ try{ window.__mlsAx.build = ob; delete window.__mlsAx.__t7wrap; }catch(e){} });
  }
  var faceObs = new MutationObserver(deb(function(){ ensureAxBar(); fixFaces(); }, 300));
  function watchAv(){
    var av = $("analysisView");
    if (av) { try { faceObs.observe(av, { childList:true, subtree:true }); } catch(e){} ensureAxBar(); fixFaces(); }
  }
  onRevert(function(){ try{ faceObs.disconnect(); }catch(e){}
    try{ var b=$("t7AxBar"); if(b)b.remove(); }catch(e){}
    try{ var k=$("t7KtHint"); if(k)k.remove(); }catch(e){} });

  /* ==================== STUDY GROUPS ==================== */
  var SG_KEY = "mls_studygroups_v1";
  function sgApi(){ return window.__mlsStudyGroups || null; }
  function sgStore(){ try { return JSON.parse(localStorage.getItem(SG_KEY) || "null"); } catch(e){ return null; } }
  function sgSave(st){ try { localStorage.setItem(SG_KEY, JSON.stringify(st)); return true; } catch(e){ return false; } }
  function sgSel(){ return $("mls-sg-group"); }
  function sgCurrentGroup(){
    var api = sgApi(), sel = sgSel();
    if (!api || !sel) return null;
    try { return api.list().find(function(g){ return g.id === sel.value; }) || null; } catch(e){ return null; }
  }
  function sgStatus(kind, html){
    var box = $("t7SgStatus");
    if (!box) {
      var anchor = $("mls-sg-importbtn");
      var card = anchor && anchor.closest(".mls-sg-card");
      if (!card) return null;
      box = document.createElement("div");
      box.id = "t7SgStatus";
      card.appendChild(box);
    }
    if (!kind) { box.className = ""; box.style.display = "none"; box.innerHTML = ""; return box; }
    box.className = "t7-" + kind; box.innerHTML = html;
    return box;
  }

  function fixBadge(){
    try {
      var root = $("mls-sg-root"); if (!root) return;
      root.querySelectorAll("span,em,i,b").forEach(function(el){
        if (/v1\s*·\s*staging/i.test(el.textContent||"")) el.remove();
      });
    } catch(e){}
  }

  /* alert() → inline status while a Study-Groups action is in flight */
  var alertWindowUntil = 0, origAlert = window.alert;
  function armAlerts(){ alertWindowUntil = Date.now() + 6000; }
  window.alert = function(m){
    if (Date.now() < alertWindowUntil && $("mls-sg-root")) {
      var s = String(m);
      sgStatus(/failed|invalid|required|error/i.test(s) ? "err" : "ok", esc(s));
      return;
    }
    return origAlert.apply(window, arguments);
  };
  onRevert(function(){ try{ window.alert = origAlert; }catch(e){} });

  /* selection persistence */
  var wantGid = null;
  function rememberSel(){ var s=sgSel(); if (s && s.value) wantGid = s.value; }
  function restoreSel(){
    try {
      var s = sgSel(); if (!s || !wantGid) return;
      var has = Array.prototype.some.call(s.options, function(o){ return o.value === wantGid; });
      if (has && s.value !== wantGid) {
        s.value = wantGid;
        s.dispatchEvent(new Event("change", { bubbles:true }));
      }
    } catch(e){}
  }
  function onSelChange(ev){
    if (ev.target && ev.target.id === "mls-sg-group") {
      wantGid = ev.target.value;
      var st = $("mls-sg-athena-status"); if (st) st.textContent = "";   // stale cross-group status
      sgStatus(null);
    }
  }
  document.addEventListener("change", onSelChange, true);
  onRevert(function(){ document.removeEventListener("change", onSelChange, true); });

  /* validation helpers */
  function validDob(s){
    if (!s) return true; /* optional */
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + "T00:00:00");
    return !isNaN(d) && d.getFullYear() >= 1900 && d.getFullYear() <= (new Date()).getFullYear();
  }
  function validName(s){ return !!s && s.trim().length >= 2 && /[A-Za-z]/.test(s); }
  function csvRows(text){
    return text.split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean)
      .filter(function(l,i){ return !(i===0 && /^name\s*,/i.test(l)); })
      .map(function(l){ var p=l.split(",").map(function(x){return x.trim();}); return { line:l, name:p[0]||"", dob:p[1]||"", ok: validName(p[0]) && (!p[1] || validDob(p[1])) }; });
  }

  /* deferred re-dispatch with painted overlay (setTimeout — rAF stalls in throttled tabs) */
  function passHeavy(ev, host, label){
    ev.stopImmediatePropagation(); ev.preventDefault();
    var o = busyOn(host || document.body, label);
    var target = ev.target;
    armAlerts(); rememberSel();
    setTimeout(function(){
      try {
        var e2 = new MouseEvent("click", { bubbles:true, cancelable:true, view:window });
        e2.__t7pass = true;
        target.dispatchEvent(e2);
      } catch(e){}
      setTimeout(function(){
        busyOff(o); restoreSel(); ensureRemoveButtons(); refreshCounts();
      }, 120);
    }, 30);
  }

  /* ONE capture router: validation first, then busy-overlay deferral */
  function captureRouter(ev){
    try {
      if (ev.__t7pass) { armAlerts(); rememberSel(); return; }
      var t = ev.target; if (!t || !t.closest) return;

      /* analysis tile expand — heavy */
      if (t.closest("#analysisView .ax-prev")) {
        passHeavy(ev, t.closest(".ax-tile"), "Opening…");
        return;
      }

      /* add patient — validate, then let through (light) */
      if (t.closest("#mls-sg-add")) {
        armAlerts(); rememberSel();
        var nm = ($("mls-sg-pname")||{}).value || "", db = ($("mls-sg-pdob")||{}).value || "";
        if (!validName(nm)) { ev.stopImmediatePropagation(); ev.preventDefault(); sgStatus("err","Patient name is required (letters, at least 2 characters)."); return; }
        if (db && !validDob(db)) { ev.stopImmediatePropagation(); ev.preventDefault(); sgStatus("err","DOB must be a real date in YYYY-MM-DD format (e.g. 1990-01-15)."); return; }
        sgStatus(null); setTimeout(function(){ restoreSel(); ensureRemoveButtons(); refreshCounts(); }, 350);
        return;
      }

      /* import — validate, then heavy-defer */
      if (t.closest("#mls-sg-importbtn")) {
        armAlerts(); rememberSel();
        var ta = $("mls-sg-import"); var raw = (ta && ta.value || "").trim();
        if (!raw) { ev.stopImmediatePropagation(); ev.preventDefault(); sgStatus("err","Nothing to import — paste CSV (name,dob,mrn) or JSON first."); return; }
        if (raw[0] === "{" || raw[0] === "[") {
          try { JSON.parse(raw); }
          catch(pe){ ev.stopImmediatePropagation(); ev.preventDefault(); sgStatus("err","That JSON is not valid: " + esc(String(pe.message||pe).slice(0,120)) + ". Fix it and try again."); return; }
          passHeavy(ev, t.closest(".mls-sg-card"), "Importing…"); return;
        }
        var rows = csvRows(raw);
        var bad = rows.filter(function(r){ return !r.ok; });
        if (!rows.length) { ev.stopImmediatePropagation(); ev.preventDefault(); sgStatus("err","No usable rows found. Format: name, dob (YYYY-MM-DD), mrn."); return; }
        if (bad.length) {
          ev.stopImmediatePropagation(); ev.preventDefault();
          var good = rows.filter(function(r){ return r.ok; });
          var box = sgStatus("err",
            esc(bad.length) + " of " + esc(rows.length) + " row(s) look invalid (e.g. “" + esc(bad[0].line.slice(0,40)) + "”)." +
            (good.length ? ' <button type="button" id="t7ImpGood">Import the ' + good.length + " valid row(s)</button>" : " Fix the list and try again.") +
            ' <button type="button" id="t7ImpCancel">Cancel</button>');
          if (box) {
            var g = $("t7ImpGood");
            if (g) g.onclick = function(){
              ta.value = good.map(function(r){ return r.line; }).join("\n");
              sgStatus("info","Importing " + good.length + " valid row(s)…");
              armAlerts(); rememberSel();
              var e2 = new MouseEvent("click",{bubbles:true,cancelable:true}); e2.__t7pass = true;
              $("mls-sg-importbtn").dispatchEvent(e2);
              setTimeout(function(){ restoreSel(); ensureRemoveButtons(); refreshCounts(); }, 400);
            };
            var c = $("t7ImpCancel"); if (c) c.onclick = function(){ sgStatus(null); };
          }
          return;
        }
        passHeavy(ev, t.closest(".mls-sg-card"), "Importing…");
        return;
      }

      /* run study — empty guard, then heavy-defer */
      if (t.closest("#mls-sg-run")) {
        armAlerts(); rememberSel();
        var g0 = sgCurrentGroup();
        if (g0 && (!g0.patients || !g0.patients.length)) {
          ev.stopImmediatePropagation(); ev.preventDefault();
          sgStatus("info","“" + esc(g0.name) + "” has no patients yet — add or import patients above, then run the study.");
          return;
        }
        passHeavy(ev, t.closest(".mls-sg-card"), "Running study — chart, Excel and PDF…");
        return;
      }

      /* athena pull — empty guard, honest timer, heavy-defer */
      if (t.closest("#mls-sg-athena")) {
        armAlerts(); rememberSel();
        var g1 = sgCurrentGroup();
        if (g1 && (!g1.patients || !g1.patients.length)) {
          ev.stopImmediatePropagation(); ev.preventDefault();
          sgStatus("info","Add patients to the group first — the athena pull looks each one up (read-only).");
          return;
        }
        startPullTimer();
        passHeavy(ev, t.closest(".mls-sg-card"), "Starting athena read…");
        return;
      }

      /* create/delete: allow module default, then refresh augmentations */
      if (t.closest("#mls-sg-create") || t.closest("#mls-sg-del")) {
        armAlerts();
        wantGid = null;
        setTimeout(function(){ ensureRemoveButtons(); refreshCounts(); }, 400);
      }
    } catch(e){}
  }
  document.addEventListener("click", captureRouter, true);
  onRevert(function(){ document.removeEventListener("click", captureRouter, true); });

  /* elapsed timer while the module's own status shows "Pulling k/n" */
  var pullTimer = null;
  function startPullTimer(){
    var t0 = Date.now();
    if (pullTimer) clearInterval(pullTimer);
    pullTimer = setInterval(function(){
      var st = $("mls-sg-athena-status");
      if (!st) { clearInterval(pullTimer); pullTimer=null; return; }
      var pulling = /Pulling/i.test(st.textContent||"");
      var secs = Math.round((Date.now()-t0)/1000);
      if (pulling) {
        sgStatus("info","Reading athena (read-only)… " + secs + "s elapsed. Each patient can take ~20s; leave your athenaOne tab open.");
      } else if ((st.textContent||"").trim() && secs > 3) {
        sgStatus("ok", esc(st.textContent.trim())); clearInterval(pullTimer); pullTimer=null;
        setTimeout(function(){ ensureRemoveButtons(); }, 300);
      }
      if (secs > 900) { clearInterval(pullTimer); pullTimer=null; }
    }, 1000);
  }
  onRevert(function(){ if (pullTimer) clearInterval(pullTimer); });

  /* per-patient remove buttons (rows render as "<name> · <dob> … N visit(s)") */
  function ensureRemoveButtons(){
    try {
      var root = $("mls-sg-root"); if (!root) return;
      var rows = Array.prototype.filter.call(root.querySelectorAll("div"), function(d){
        return /visit\(s\)\s*$/.test((d.textContent||"").trim()) && d.children.length <= 3 && !d.querySelector("select,textarea,input,button.mls-sg-btn");
      });
      var g = sgCurrentGroup(); if (!g) return;
      rows.forEach(function(row){
        if (row.querySelector(".t7-rm")) return;
        var label = (row.textContent||"").trim();
        var btn = document.createElement("button");
        btn.className = "t7-rm"; btn.type = "button"; btn.title = "Remove from group"; btn.textContent = "✕";
        btn.addEventListener("click", function(ev){
          ev.stopPropagation();
          var name = label.split("·")[0].trim().replace(/\s+\d{4}-\d{2}-\d{2}.*$/,"").trim();
          sgStatus("err","Remove “" + esc(name) + "” from “" + esc(g.name) + "”?" +
            ' <button type="button" id="t7RmYes">Remove</button> <button type="button" id="t7RmNo">Keep</button>');
          var y = $("t7RmYes"), n0 = $("t7RmNo");
          if (n0) n0.onclick = function(){ sgStatus(null); };
          if (y) y.onclick = function(){
            try {
              var st = sgStore(); if (!st) return;
              var arr = Array.isArray(st) ? st : (st.groups || []);
              var gg = arr.find(function(x){ return x.id === g.id; }); if (!gg) return;
              var before = gg.patients.length;
              var idx = gg.patients.findIndex(function(p){ return label.indexOf(p.name) === 0; });
              if (idx < 0) { sgStatus("err","Could not match that row to a stored patient — no change made."); return; }
              gg.patients.splice(idx,1);
              if (!sgSave(st)) { sgStatus("err","Could not save the change."); return; }
              sgStatus("ok","Removed. (" + before + " → " + gg.patients.length + " patient(s))");
              wantGid = g.id;
              var sel = sgSel();
              if (sel) { sel.dispatchEvent(new Event("change",{bubbles:true})); }  /* module re-renders list */
              setTimeout(function(){ restoreSel(); ensureRemoveButtons(); refreshCounts(); }, 250);
            } catch(e){ sgStatus("err","Remove failed: " + esc(String(e).slice(0,80))); }
          };
        });
        row.appendChild(btn);
      });
    } catch(e){}
  }
  /* counts in the select labels can go stale after store edits */
  function refreshCounts(){
    try {
      var api = sgApi(), sel = sgSel(); if (!api || !sel) return;
      api.list().forEach(function(g){
        var o = Array.prototype.find.call(sel.options, function(o){ return o.value === g.id; });
        if (o) o.textContent = g.name + " (" + (g.patients||[]).length + ")";
      });
    } catch(e){}
  }

  /* rename group */
  function ensureRename(){
    try {
      var sel = sgSel(); if (!sel || $("t7SgRename")) return;
      var b = document.createElement("button");
      b.id = "t7SgRename"; b.type = "button"; b.title = "Rename selected group"; b.textContent = "✎ Rename";
      sel.parentElement.insertBefore(b, sel.nextSibling);
      b.addEventListener("click", function(){
        var g = sgCurrentGroup(); if (!g) return;
        var nn = window.prompt("New name for “" + g.name + "”:", g.name);
        if (!nn || !nn.trim() || nn.trim() === g.name) return;
        try {
          sgApi().renameGroup(g.id, nn.trim());
          wantGid = g.id;
          var o = Array.prototype.find.call(sel.options, function(o){ return o.value === g.id; });
          if (o) o.textContent = nn.trim() + " (" + (g.patients||[]).length + ")";
          sgStatus("ok","Renamed to “" + esc(nn.trim()) + "”.");
        } catch(e){ sgStatus("err","Rename failed: " + esc(String(e).slice(0,80))); }
      });
    } catch(e){}
  }

  /* keep SG augmentations alive across the module's re-renders */
  var sgObs = new MutationObserver(deb(function(){ fixBadge(); ensureRename(); ensureRemoveButtons(); }, 250));
  function watchSg(){
    var root = $("mls-sg-root");
    if (root) { try { sgObs.observe(root, { childList:true, subtree:true }); } catch(e){} fixBadge(); ensureRename(); ensureRemoveButtons(); }
  }
  onRevert(function(){ try{ sgObs.disconnect(); }catch(e){}
    try{ var b=$("t7SgRename"); if(b)b.remove(); }catch(e){}
    try{ var s=$("t7SgStatus"); if(s)s.remove(); }catch(e){}
    try{ document.querySelectorAll(".t7-rm,.t7-busy,.t7-face-note").forEach(function(n){ n.remove(); }); }catch(e){} });

  /* ============================ boot ============================ */
  var bootTries = 0;
  var bootIv = setInterval(function(){
    bootTries++;
    watchAv(); watchSg();
    if (($("analysisView") && $("mls-sg-root")) || bootTries > 40) clearInterval(bootIv);
  }, 700);
  onRevert(function(){ clearInterval(bootIv); });
  watchAv(); watchSg();

  window.__mlsT7 = {
    __live: true, version: VER,
    refreshFaces: fixFaces,
    revert: function(){
      cleanup.forEach(function(f){ try{ f(); }catch(e){} });
      try { delete window.__mlsT7; } catch(e){ window.__mlsT7 = undefined; }
    }
  };
})();
