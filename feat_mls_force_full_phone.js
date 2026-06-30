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
      recording card. Mirrors the live QR; no duplicate QR mechanism.
*/
(function(){
  'use strict';
  if (window.__mlsFFP) return;
  var S = { on:true, gen:false, sched:false, lastForce:0 };
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
    + '#mlsGpQrBox a{font-size:10px;color:#2563eb;word-break:break-all}'
    + '#mlsGpQrBox .h{font-size:11px;color:#5b6b85}'
    + '#mlsGpPhoneBtn{display:inline-block;margin:10px 8px 0 0;padding:9px 14px;border-radius:10px;border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer}';
    (document.head || document.documentElement).appendChild(st);
  }

  /* --- 1) force the single full view --- */
  function forceFull(){
    try { localStorage.setItem('mls.easy.viewPref', 'complex'); } catch(e){}
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
        S.gen = true;
        setTimeout(syncQR, 900);
        setTimeout(syncQR, 2200);
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
    var link = pairLink();
    var a = document.getElementById('mlsGpLink');
    var code = document.getElementById('mlsGpCode');
    if (link && a) {
      a.href = link.href;
      a.textContent = stripProto(link.href);
      var cd = codeFromUrl(link.href);
      if (code && cd) code.textContent = 'Code ' + cd;
    }
  }

  /* --- 3) QR top-right of the recording card --- */
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
      + '<div class="h" id="mlsGpHint">Tap to show a scan code</div>'
      + '<div class="c" id="mlsGpCode"></div>'
      + '<a id="mlsGpLink" target="_blank" rel="noopener"></a>';
      box.addEventListener('click', function(e){ if (e.target.tagName !== 'A') pair(); });
      card.appendChild(box);
    }
    var realQR = document.getElementById('phoneMicQR');
    if (realQR && !realQR.src && !S.gen) pair(); /* auto-generate the pairing QR once */
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
  function schedule(){ if (S.sched) return; S.sched = true; setTimeout(function(){ S.sched = false; tick(); }, 250); }

  function boot(){
    tick();
    try {
      var mo = new MutationObserver(schedule);
      mo.observe(document.body, { childList:true, subtree:true });
    } catch(e){}
    setInterval(function(){ forceFull(); syncQR(); }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
