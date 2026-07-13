/* feat_mls_force_full_phone.js
   MLS prod enhancement. ADDITIVE + REVERSIBLE. No internal mode keys/classes/ids changed.
   To revert: delete this file AND remove its loader line at the end of mls-connect.js.

   1) Retires "Simple/Guided" mode: hides the view-mode toggle (#mlsViewToggle) and the
      "Use MLS Easy" switch link (#ezBackEasy), and forces the single full view
      (mode='full', mls.easy.viewPref='complex'). Easy/simple records and code are left
      intact (just not shown).
   2) Surfaces the EXISTING phone-record control next to the Start button (#captureBtn) in
      the full view's recording card. Reuses #phoneMicBtn / window.startPhoneMic(). No new recorder.
   3) Surfaces the EXISTING phone-record pairing QR (#phoneMicQR) in the top-right of the
      recording card and PRE-GENERATES it on load (reusing window.startPhoneMic) so it is
      visible and scannable immediately, with no extra click. Mirrors the live QR; no
      duplicate QR mechanism. Retries generation until the live pairing code exists.
*/
(function(){
  'use strict';
  if (window.__mlsFFP) return;
  var S = { on:true, tries:0, sched:false, lastForce:0 };
  window.__mlsFFP = S;

  function addStyle(){
    if (document.getElementById('mlsFfpStyle')) return;
    var st = document.createElement('style'); st.id = 'mlsFfpStyle';
    st.textContent =
      '#mlsViewToggle{display:none !important}'
    + '#ezBackEasy{display:none !important}'
    + '#mlsGpQrBox{position:absolute;top:12px;right:12px;z-index:50;background:#fff;border:1px solid #dbe3ee;border-radius:12px;padding:10px;width:168px;text-align:center;font:12px system-ui,-apple-system,sans-serif;color:#0f1b33;box-shadow:0 2px 10px rgba(20,40,80,.08)}'
    + '#mlsGpQrBox img{width:138px;height:138px;display:block;margin:6px auto;background:#f3f6fb;border-radius:6px}'
    + '#mlsGpQrBox .c{font-weight:600;letter-spacing:1px;margin-top:2px}'
    + '#mlsGpQrBox a{font-size:10px;color:#2E6A4B;word-break:break-all}'
    + '#mlsGpQrBox .h{font-size:11px;color:#2E6A4B}'
    + '#mlsGpPhoneBtn{display:inline-block;margin:10px 8px 0 0;padding:9px 14px;border-radius:10px;border:1px solid #EAF1EE;background:#eef2ff;color:#204034;font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer}';
    (document.head || document.documentElement).appendChild(st);
  }

  /* --- 1) force the single full view --- */
  function forceFull(){
    try { if (localStorage.getItem('mls.easy.viewPref') !== 'complex') localStorage.setItem('mls.easy.viewPref', 'complex'); } catch(e){}
    try {
      var s = window.__mlsEasy && window.__mlsEasy.state;
      if (s && s.mode !== 'full') {
        var now = Date.now();
        if (now - S.lastForce > 2000) {
          S.lastForce = now;
          var f = document.getElementById('mlsVtFull');
          if (f) f.click();
        }
      }
    } catch(e){}
  }

  /* --- phone-record helpers (reuse existing mechanism) --- */
  function pairLink(){ return document.querySelector('a[href*="phone.html?code="]'); }

  function pair(){
    try {
      if (typeof window.startPhoneMic === 'function') {
        window.startPhoneMic();
        setTimeout(syncQR, 700);
        setTimeout(syncQR, 1800);
      }
    } catch(e){}
  }

  function stripProto(u){
    if (u.indexOf('https://') === 0) return u.slice(8);
    if (u.indexOf('http://') === 0) return u.slice(7);
    return u;
  }
  function codeFromUrl(u){
    var i = u.indexOf('code=');
    if (i < 0) return '';
    var cd = u.slice(i + 5);
    var amp = cd.indexOf('&');
    if (amp >= 0) cd = cd.slice(0, amp);
    return cd;
  }

  function syncQR(){
    var realQR = document.getElementById('phoneMicQR');
    var img = document.getElementById('mlsGpQrImg');
    if (realQR && img && realQR.src && img.src !== realQR.src) {
      img.src = realQR.src;
      img.style.display = 'block';
      var hint = document.getElementById('mlsGpHint');
      if (hint) hint.style.display = 'none';
    }
    /* Derive the code label AND link from the SAME source as the scannable image
       (the QR's encoded phone.html?code= URL), so the image, the code label and
       the link can never drift to two different pairing codes. Fall back to the
       pair anchor only if the QR image has no encoded URL yet. */
    var canonUrl = (realQR && realQR.src) ? (function(s){ try{ var i=s.indexOf('data='); if(i<0) return ''; var d=s.slice(i+5); var amp=d.indexOf('&'); if(amp>=0) d=d.slice(0,amp); return decodeURIComponent(d); }catch(e){ return ''; } })(realQR.src) : '';
    if (!canonUrl) { var link = pairLink(); if (link) canonUrl = link.href; }
    var a = document.getElementById('mlsGpLink');
    var code = document.getElementById('mlsGpCode');
    if (canonUrl && a) {
      var _lt = stripProto(canonUrl);
      if (a.getAttribute('href') !== canonUrl) a.href = canonUrl; /* b171: idempotent writes so syncQR stops self-triggering its own observer */
      if (a.textContent !== _lt) a.textContent = _lt;
    }
    if (canonUrl && code) {
      var cd = codeFromUrl(canonUrl);
      if (cd) { var _ct = 'Code ' + cd; if (code.textContent !== _ct) code.textContent = _ct; }
    }
  }

  /* --- 3) QR top-right of the recording card; pre-generated on load --- */
  function ensureQR(){
    var card = document.getElementById('captureCard');
    var startBtn = document.getElementById('captureBtn');
    if (!card || !startBtn) return; /* only on the recording card */
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    if (!document.getElementById('mlsGpQrBox')) {
      var box = document.createElement('div');
      box.id = 'mlsGpQrBox';
      box.innerHTML =
        '<div>&#128241; Record on phone</div>'
      + '<img id="mlsGpQrImg" alt="Scan to record on phone" style="display:none">'
      + '<div class="h" id="mlsGpHint">Preparing scan code&#8230;</div>'
      + '<div class="c" id="mlsGpCode"></div>'
      + '<a id="mlsGpLink" target="_blank" rel="noopener"></a>';
      box.addEventListener('click', function(e){ if (e.target.tagName !== 'A') pair(); });
      var __m=document.getElementById('visitHero')||card;if(__m&&getComputedStyle(__m).position==='static'){__m.style.position='relative';}__m.appendChild(box);
    }
    /* Pre-generate the pairing QR (reusing startPhoneMic). Retry until the live code exists. */
    var realQR = document.getElementById('phoneMicQR');
    if (realQR && !realQR.src && S.tries < 8) { S.tries++; pair(); }
    syncQR();
  }

  /* --- 2) phone-record option next to the Start button --- */
  function ensurePhoneOption(){
    var startBtn = document.getElementById('captureBtn');
    if (!startBtn) return;
    var existing = document.getElementById('phoneMicBtn'); /* the app's own phone-mic control */
    if (existing) {
      if (startBtn.nextElementSibling !== existing) startBtn.insertAdjacentElement('afterend', existing);
      existing.style.display = '';
    } else if (!document.getElementById('mlsGpPhoneBtn')) {
      var b = document.createElement('button');
      b.id = 'mlsGpPhoneBtn';
      b.type = 'button';
      b.innerHTML = '&#128241; Record on phone instead';
      b.addEventListener('click', pair);
      startBtn.insertAdjacentElement('afterend', b);
    }
  }

  function tick(){ try { addStyle(); forceFull(); ensureQR(); ensurePhoneOption(); syncQR(); } catch(e){} }
  function schedule(){ if (S.sched) return; S.sched = true; setTimeout(function(){ S.sched = false; tick(); }, 200); }

  function boot(){
    tick();
    try {
      var mo = new MutationObserver(schedule);
      mo.observe(document.body, { childList:true, subtree:true });
    } catch(e){}
    setInterval(tick, 1500); /* self-heal: keep full view + phone option + QR present and current */
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
