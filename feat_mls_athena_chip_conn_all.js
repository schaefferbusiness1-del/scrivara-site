/* feat_mls_athena_chip_conn_all.js  (item31)
   UNIFY the context-bar Athena chip with the single connection source of truth
   on EVERY tab -- finishing what item30 started.

   Disconnect being fixed: item30 (feat_mls_athena_chip_conn.js) made the
   context-bar Athena chip honour __mlsConnTruth, but ONLY in its no-activity
   "idle" state (class mls-sync-idle). On tabs where __mlsSync has a last-sync
   timestamp the chip renders the "ok" state -- a GREEN "Athena · synced 1d ago"
   -- and item30 leaves it untouched. Result observed live: the SAME persistent
   chip shows RED "Athena · not connected" on the Visit tab (idle, decorated by
   item30) but GREEN "Athena · synced 1d ago" on History / Patients / Calendar
   (ok state), at the same moment, for the same patient, while __mlsConnTruth
   says red / "No signed-in athenaOne tab". One concept (is athenaOne connected
   right now?) answered two contradictory ways depending on which tab you are on,
   and the green "synced" reads as a live connection when there is none.

   Fix: extend item30's exact rule to the non-idle state. When -- and ONLY when --
   __mlsConnTruth says NOT connected (color red), recolour the chip and set its
   text to "Athena · not connected", the identical text + colour item30 already
   shows on the Visit tab. Now the chip says the same honest thing on every tab.
   When __mlsConnTruth says connected (green), the "synced … ago" chip already
   agrees, so we leave it COMPLETELY untouched. We never override the idle state
   (item30 owns it), never touch amber/checking (avoid false alarms), and never
   fabricate: if __mlsConnTruth is absent we leave the chip exactly as-is. We
   never modify __mlsSync, __mlsConnTruth, or item30 -- we only read describe()
   and update the chip's text node + colour class, mirroring item30.

   Strictly additive + reversible: window.__mlsAthenaChipConnAll.revert() stops
   the watcher and re-renders the original chip via __mlsSync.render().
*/
(function () {
  if (window.__mlsAthenaChipConnAll) return;

  var SLOT_ID = 'mlsCardSlot';
  var MARK = '__mlsConnDecorAll';
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
    if (isIdle(c)) return;                  // idle state belongs to item30 -- never touch it
    var d = truth();
    if (!d) return;                         // no source of truth -> leave as-is (no fabrication)
    if (String(d.color) !== 'red') {        // only act when truth is definitively NOT connected
      // truth is connected / checking / amber: the "synced … ago" chip is fine -- if we
      // had previously decorated it, let __mlsSync re-render the honest timestamp.
      if (c[MARK]) { try { delete c[MARK]; } catch (e) { c[MARK] = undefined; } restore(c); }
      return;
    }
    var want = 'Athena · not connected';    // identical to the Visit-tab chip (item30)
    var sig = want + '|mlsconn-red';
    if (c[MARK] === sig && /mlsconn-red/.test(c.className)) return; // already decorated
    var tn = textNodeOf(c);
    if (!tn) return;
    applying = true;
    try {
      tn.nodeValue = want;
      c.className = c.className.replace(/\s*mlsconn-(green|red|amber|grey)\b/g, '') + ' mlsconn-red';
      c[MARK] = sig;
    } catch (e) {}
    applying = false;
  }

  function restore(c) {
    // remove our colour override and let __mlsSync rebuild the canonical chip text
    try {
      c.className = c.className.replace(/\s*mlsconn-(green|red|amber|grey)\b/g, '');
    } catch (e) {}
    try { if (window.__mlsSync && typeof window.__mlsSync.render === 'function') window.__mlsSync.render(); } catch (e) {}
  }

  function injectCss() {
    // item30 already ships #mlsConnDecorCss with the .mls-sync.mlsconn-* rules.
    // Add our own copy under a distinct id so this module stands alone and is
    // safe whether or not item30 is present/reverted.
    if (document.getElementById('mlsConnDecorAllCss')) return;
    var s = document.createElement('style');
    s.id = 'mlsConnDecorAllCss';
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

  window.__mlsAthenaChipConnAll = {
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
      try {
        var c = chip();
        if (c && c[MARK]) {
          try { delete c[MARK]; } catch (e) { c[MARK] = undefined; }
          c.className = c.className.replace(/\s*mlsconn-(green|red|amber|grey)\b/g, '');
        }
      } catch (e) {}
      try { var css = document.getElementById('mlsConnDecorAllCss'); if (css) css.remove(); } catch (e) {}
      try { if (window.__mlsSync && typeof window.__mlsSync.render === 'function') window.__mlsSync.render(); } catch (e) {}
      try { delete window.__mlsAthenaChipConnAll; } catch (e) { window.__mlsAthenaChipConnAll = undefined; }
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
