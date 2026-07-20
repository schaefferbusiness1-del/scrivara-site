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
            var cached = last.get(this);
            /* b439: a write may be skipped only when it is TRULY redundant -
               we wrote this exact string AND the element still holds what that
               write produced.
               The original guard compared the incoming string to the last
               string alone. Several owners mutate this bar's children by other
               routes (appendChild / remove() / writing a CHILD's innerHTML,
               none of which pass through this setter for #mlsCtxBar), so the
               live DOM could diverge while the cache still said "already
               wrote that". The repair path then rebuilt byte-identical markup
               and this setter SILENTLY DISCARDED it - so a patient bar that
               lost its Chart / Visit / History / Schedule controls could never
               be restored for the rest of the session, which is exactly the
               reported "no buttons on the patient bar after logging in".
               Verifying against live serialization keeps the anti-flicker
               purpose intact (a genuine no-op re-render still skips) while
               making it impossible to suppress a real repair. */
            if (cached && cached.value === s && desc.get.call(this) === cached.rendered) return;
            desc.set.call(this, s);
            try { last.set(this, { value: s, rendered: desc.get.call(this) }); } catch (e2) { last.delete(this); }
            return;
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
