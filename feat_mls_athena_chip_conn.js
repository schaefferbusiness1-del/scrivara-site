/* feat_mls_athena_chip_conn.js  (item30)
   UNIFY the context-bar Athena chip with the single connection source of truth.

   Disconnect being fixed: the persistent Athena chip in the patient context
   bar (#mlsCardSlot, rendered by the __mlsSync module) shows a grey
   "Athena * idle" whenever there has been no push/pull activity yet -- EVEN
   WHEN athenaOne is actually connected and readable. Meanwhile the MLS
   Assistant status (item20) and the connection dot already read from
   __mlsConnTruth and say "connected". So the SAME concept (is athenaOne
   connected?) is shown two ways that disagree: the context-bar chip looks
   dead/idle while every other surface says connected.

   Fix: when -- and ONLY when -- the chip is in its no-activity "idle" state,
   decorate it to reflect __mlsConnTruth.describe() (the SAME source of truth
   item20 established): a green "Athena * connected" when a signed-in athenaOne
   tab is readable, or the honest not-connected / checking label otherwise. The
   moment real sync activity exists, __mlsSync's own "synced/pulled Xm ago"
   takes over and we leave it COMPLETELY untouched. We never claim FHIR
   write-back, and we never fabricate: if __mlsConnTruth is absent we leave the
   chip exactly as-is.

   Strictly additive + reversible: window.__mlsAthenaChipConn.revert() removes
   the decoration, drops the injected CSS, and re-renders the original chip via
   __mlsSync.render(). Never modifies __mlsSync or __mlsConnTruth; only reads
   describe() and updates the idle chip's text node + dot colour.
*/
(function () {
  if (window.__mlsAthenaChipConn) return;

  var SLOT_ID = 'mlsCardSlot';
  var MARK = '__mlsConnDecor';
  var observer = null, unsub = null, poll = null, retry = null;
  var stopped = false, applying = false;

  function truth() {
    try {
      if (!window.__mlsConnTruth || typeof window.__mlsConnTruth.describe !== 'function') return null;
      var d = window.__mlsConnTruth.describe(window.__mlsConnTruth.state);
      if (!d || !d.status) return null;
      return d; // { status, color, label, detail }
    } catch (e) { return null; }
  }

  function suffixFor(d) {
    var s = String(d.status || '').toLowerCase();
    if (s === 'connected') return 'connected';
    if (/check|pending|loading/.test(s)) return 'checking…';
    return 'not connected';
  }

  function colorClass(d) {
    switch (String(d.color)) {
      case 'green':  return 'mlsconn-green';
      case 'red':    return 'mlsconn-red';
      case 'amber':
      case 'yellow': return 'mlsconn-amber';
      default:       return 'mlsconn-grey';
    }
  }

  function chip() {
    var slot = document.getElementById(SLOT_ID);
    return slot ? slot.querySelector('.mls-sync') : null;
  }

  function isIdle(c) {
    return !!c && /(^|\s)mls-sync-idle(\s|$)/.test(c.className);
  }

  function textNodeOf(c) {
    for (var i = c.childNodes.length - 1; i >= 0; i--) {
      if (c.childNodes[i].nodeType === 3) return c.childNodes[i];
    }
    return null;
  }

  function apply() {
    if (stopped) return;
    var c = chip();
    if (!c) return;
    if (!isIdle(c)) return;                 // only ever touch the no-activity idle state
    var d = truth();
    if (!d) return;                         // no source of truth -> leave as-is (no fabrication)
    var want = 'Athena · ' + suffixFor(d);
    var cls = colorClass(d);
    var sig = want + '|' + cls;
    if (c[MARK] === sig) return;            // already decorated for this exact state
    var tn = textNodeOf(c);
    if (!tn) return;
    applying = true;
    try {
      tn.nodeValue = want;
      c.className = c.className.replace(/\s*mlsconn-(green|red|amber|grey)\b/g, '') + ' ' + cls;
      c[MARK] = sig;
    } catch (e) {}
    applying = false;
  }

  function injectCss() {
    if (document.getElementById('mlsConnDecorCss')) return;
    var s = document.createElement('style');
    s.id = 'mlsConnDecorCss';
    s.textContent =
        '.mls-sync.mlsconn-green{color:#127a55;border-color:#bfe6cf;background:#f0fbf4;}'
      + '.mls-sync.mlsconn-green .mls-sync-dot{background:#2E6A4B;}'
      + '.mls-sync.mlsconn-amber{color:#92600a;border-color:#f3e0b6;background:#fdf8ec;}'
      + '.mls-sync.mlsconn-amber .mls-sync-dot{background:#d97706;}'
      + '.mls-sync.mlsconn-red{color:#b91c1c;border-color:#f3c9c9;background:#fdf2f2;}'
      + '.mls-sync.mlsconn-red .mls-sync-dot{background:#dc2626;}'
      + '.mls-sync.mlsconn-grey .mls-sync-dot{background:#9aa7b4;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function watchSlot() {
    var slot = document.getElementById(SLOT_ID);
    if (!slot) return false;
    observer = new MutationObserver(function () {
      if (applying) return;                 // ignore our own edits
      apply();
    });
    observer.observe(slot, { childList: true, subtree: true, characterData: true });
    return true;
  }

  function start() {
    injectCss();
    if (!watchSlot()) {
      var tries = 0;
      retry = setInterval(function () {
        if (stopped || watchSlot() || ++tries > 40) { clearInterval(retry); retry = null; apply(); }
      }, 250);
    }
    try {
      if (window.__mlsConnTruth && typeof window.__mlsConnTruth.subscribe === 'function') {
        unsub = window.__mlsConnTruth.subscribe(function () { apply(); });
      }
    } catch (e) {}
    poll = setInterval(function () { if (!stopped) apply(); }, 3000);
    apply();
  }

  window.__mlsAthenaChipConn = {
    version: '1.0.0',
    apply: apply,
    state: function () {
      var c = chip();
      return { idle: isIdle(c), text: c ? c.textContent.trim() : null, truth: truth() };
    },
    revert: function () {
      stopped = true;
      try { if (observer) observer.disconnect(); } catch (e) {}
      observer = null;
      try { if (typeof unsub === 'function') unsub(); } catch (e) {}
      unsub = null;
      try { if (poll) clearInterval(poll); } catch (e) {}
      poll = null;
      try { if (retry) clearInterval(retry); } catch (e) {}
      retry = null;
      // restore any chip we decorated back to the canonical idle chip
      // (the only state we ever touch is the no-activity "Athena · idle" chip)
      try {
        var c = chip();
        if (c && c[MARK]) {
          var tn = textNodeOf(c);
          if (tn) tn.nodeValue = 'Athena · idle';
          c.className = c.className.replace(/\s*mlsconn-(green|red|amber|grey)\b/g, '');
          try { delete c[MARK]; } catch (e) { c[MARK] = undefined; }
        }
      } catch (e) {}
      try { var css = document.getElementById('mlsConnDecorCss'); if (css) css.remove(); } catch (e) {}
      try { if (window.__mlsSync && typeof window.__mlsSync.render === 'function') window.__mlsSync.render(); } catch (e) {}
      try { delete window.__mlsAthenaChipConn; } catch (e) { window.__mlsAthenaChipConn = undefined; }
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
