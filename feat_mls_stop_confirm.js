/* feat_mls_stop_confirm.js — item62
 * "Are you sure you want to stop recording?" confirm popup.
 *
 * WHY: clicking the big Stop button (captureBtn -> toggleCapture -> stopCapture)
 * ends the visit recording immediately, so a single mis-click loses the capture.
 * This wraps toggleCapture so that when a recording is actually in progress, the
 * stop is gated behind a small, centered, on-theme confirm dialog. Only "Yes,
 * stop" calls the original stopCapture; "Keep recording" / Esc / backdrop click
 * cancels and the recording continues. Starting a recording is untouched, and
 * internal/auto stops (newVisit, loadRecordIntoEditor, nav, recog.onend) call
 * stopCapture() directly and are deliberately NOT gated.
 *
 * Additive + reversible: window.__mlsStopConfirm.revert() restores the original
 * toggleCapture and removes all injected DOM/CSS. No app data is touched.
 */
(function(){
  "use strict";
  try{
    if (window.__mlsStopConfirm && !window.__mlsStopConfirm.__reverted) return; // idempotent

    var STYLE_ID = "mls-stop-confirm-style";
    var BACKDROP_ID = "mlsStopConfirmBackdrop";

    var origToggle = (typeof window.toggleCapture === "function") ? window.toggleCapture : null;

    function isRecording(){
      // Primary truth: the page's own `capturing` flag (global lexical scope).
      try { if (typeof capturing !== "undefined") return !!capturing; } catch(_){}
      // Fallback: the Stop button wears the .recording class while live.
      var b = document.getElementById("captureBtn");
      return !!(b && b.classList.contains("recording"));
    }

    function injectStyle(){
      if (document.getElementById(STYLE_ID)) return;
      var css =
        "#"+BACKDROP_ID+"{position:fixed;inset:0;z-index:100000;display:none;"+
          "align-items:center;justify-content:center;padding:20px;"+
          "background:rgba(16,40,70,.55);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}"+
        "#"+BACKDROP_ID+".mls-sc-show{display:flex;}"+
        "#"+BACKDROP_ID+" .mls-sc-card{box-sizing:border-box;width:100%;max-width:380px;"+
          "background:var(--card,#fff);color:var(--ink,#1A211C);"+
          "border:1px solid var(--line,#E7E5DD);border-radius:16px;"+
          "padding:24px 24px 20px;text-align:center;"+
          "box-shadow:0 24px 70px rgba(0,0,0,.32);"+
          "font-family:inherit;animation:mlsScPop .14s ease-out;}"+
        "@keyframes mlsScPop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}"+
        "#"+BACKDROP_ID+" .mls-sc-icon{font-size:30px;line-height:1;margin:0 0 10px;}"+
        "#"+BACKDROP_ID+" .mls-sc-title{font-size:18px;font-weight:700;letter-spacing:-.2px;margin:0 0 6px;color:var(--ink,#1A211C);}"+
        "#"+BACKDROP_ID+" .mls-sc-msg{font-size:14px;line-height:1.45;color:var(--muted,#79837C);margin:0 0 20px;}"+
        "#"+BACKDROP_ID+" .mls-sc-actions{display:flex;gap:10px;justify-content:center;}"+
        "#"+BACKDROP_ID+" .mls-sc-btn{flex:1 1 0;min-width:0;cursor:pointer;font-family:inherit;"+
          "font-size:14.5px;font-weight:650;padding:11px 14px;border-radius:10px;border:1px solid transparent;"+
          "transition:filter .12s ease,box-shadow .12s ease;}"+
        "#"+BACKDROP_ID+" .mls-sc-keep{background:var(--card,#fff);color:var(--brand-dk,#204034);"+
          "border:1px solid var(--line,#E7E5DD);}"+
        "#"+BACKDROP_ID+" .mls-sc-keep:hover{filter:brightness(.98);box-shadow:0 1px 3px rgba(20,33,28,.10);}"+
        "#"+BACKDROP_ID+" .mls-sc-stop{background:var(--red,#e0606b);color:#fff;border-color:var(--red,#e0606b);"+
          "box-shadow:0 1px 2px rgba(20,33,28,.12);}"+
        "#"+BACKDROP_ID+" .mls-sc-stop:hover{filter:brightness(1.04);}"+
        "#"+BACKDROP_ID+" .mls-sc-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(37,99,201,.35);}";
      var st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    }

    function buildBackdrop(){
      var bd = document.getElementById(BACKDROP_ID);
      if (bd) return bd;
      bd = document.createElement("div");
      bd.id = BACKDROP_ID;
      bd.setAttribute("role","dialog");
      bd.setAttribute("aria-modal","true");
      bd.setAttribute("aria-labelledby","mlsScTitle");
      bd.innerHTML =
        '<div class="mls-sc-card" role="document">'+
          '<div class="mls-sc-icon" aria-hidden="true">&#9209;&#65039;</div>'+
          '<div class="mls-sc-title" id="mlsScTitle">Stop recording?</div>'+
          '<div class="mls-sc-msg">Are you sure you want to stop recording?</div>'+
          '<div class="mls-sc-actions">'+
            '<button type="button" class="mls-sc-btn mls-sc-keep">Keep recording</button>'+
            '<button type="button" class="mls-sc-btn mls-sc-stop">Yes, stop</button>'+
          '</div>'+
        '</div>';
      (document.body || document.documentElement).appendChild(bd);

      var keep = bd.querySelector(".mls-sc-keep");
      var stop = bd.querySelector(".mls-sc-stop");
      keep.addEventListener("click", cancel);
      stop.addEventListener("click", confirmStop);
      bd.addEventListener("mousedown", function(e){ if (e.target === bd) cancel(); });
      bd.addEventListener("keydown", function(e){ if (e.key === "Escape"){ e.preventDefault(); cancel(); } });
      return bd;
    }

    function openDialog(){
      injectStyle();
      var bd = buildBackdrop();
      bd.classList.add("mls-sc-show");
      // Default focus on the SAFE choice so Enter never stops by accident.
      try{ bd.querySelector(".mls-sc-keep").focus(); }catch(_){}
    }

    function closeDialog(){
      var bd = document.getElementById(BACKDROP_ID);
      if (bd) bd.classList.remove("mls-sc-show");
    }

    function cancel(){ closeDialog(); /* recording continues */ }

    function confirmStop(){
      closeDialog();
      try{
        if (typeof window.stopCapture === "function") window.stopCapture();
        else if (origToggle) origToggle.call(window); // capturing is still true -> stops
      }catch(e){}
    }

    function wrappedToggle(){
      // Only gate the user-initiated STOP. Starting passes straight through.
      if (isRecording()){
        openDialog();
        return; // wait for the user's choice
      }
      if (origToggle) return origToggle.apply(this, arguments);
    }

    if (origToggle){
      window.toggleCapture = wrappedToggle;
    }

    window.__mlsStopConfirm = {
      __reverted: false,
      open: openDialog,
      revert: function(){
        try{ if (origToggle) window.toggleCapture = origToggle; }catch(_){}
        try{ var bd = document.getElementById(BACKDROP_ID); if (bd && bd.parentNode) bd.parentNode.removeChild(bd); }catch(_){}
        try{ var st = document.getElementById(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st); }catch(_){}
        this.__reverted = true;
      }
    };
  }catch(e){ /* never break the host app */ }
})();
