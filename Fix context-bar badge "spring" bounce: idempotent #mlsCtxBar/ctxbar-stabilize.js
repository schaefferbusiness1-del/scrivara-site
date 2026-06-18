/* ctxbar-stabilize.js  (connectedness bug-fix asset)
 *
 * PROBLEM (the "spring" bounce): the active-patient context bar (#mlsCtxBar)
 * re-renders on a heartbeat + an amplifying observer, and every tick it rewrites
 * #mlsCtxBar.innerHTML (and the #mlsCardSlot sync slot) with BYTE-IDENTICAL
 * markup. Each rewrite tears down and recreates the bar's children - the
 * #mlsCardSlot that holds the green "Athena - synced ..." chip and the
 * .mlsctx-actions that holds the orange "Unsigned" chip - so the connectedness
 * chips get wiped and re-inserted continuously and visibly pop in/out.
 *
 * FIX: make those two elements' innerHTML writes IDEMPOTENT. A write whose value
 * equals the last value we let through for that same element is skipped, so the
 * bar renders once and stays put. When the patient/sign/sync state actually
 * changes the markup differs, the write goes through, and the badges update
 * normally. Scoped strictly to #mlsCtxBar and #mlsCardSlot; every other element
 * is delegated to the native setter byte-for-byte (verified: identical re-writes
 * on non-target elements still recreate nodes as usual).
 *
 * Self-contained IIFE, installs once, no-op on any error, no app functions
 * monkey-patched. Reversible: delete this file / remove its loader line, or call
 * window.__mlsCtxStable.revert(). No PHI, no secrets.
 */
(function () {
  try {
    if (window.__mlsCtxStable && window.__mlsCtxStable.installed) return;

    var TARGET = { mlsCtxBar: 1, mlsCardSlot: 1 };
    var proto = Element.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return;

    var last = new WeakMap();

    Object.defineProperty(proto, 'innerHTML', {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) {
        try {
          if (this && this.id && TARGET[this.id] === 1) {
            var s = '' + v;
            if (last.get(this) === s) return;   // redundant identical render -> skip
            last.set(this, s);
            return desc.set.call(this, s);
          }
        } catch (e) { /* fall through to native on any guard error */ }
        return desc.set.call(this, v);          // all other elements: unchanged
      }
    });

    window.__mlsCtxStable = {
      installed: true,
      revert: function () {
        try { Object.defineProperty(Element.prototype, 'innerHTML', desc); } catch (e) {}
        try { this.installed = false; } catch (e) {}
      }
    };
  } catch (e) { /* no-op on any failure */ }
})();
