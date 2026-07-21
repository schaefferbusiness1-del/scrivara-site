---
name: mls-emergency-rollback
description: Emergency response when a deployed MLS change breaks the owner's live session (frozen tab, broken boot). Proven with the b473→b474 renderer-wedge rollback in under 15 minutes on 2026-07-21.
---

# Emergency rollback (proven b473→b474)

When the owner reports breakage right after YOUR deploy, assume guilt until proven otherwise — but PROBE first (mls-live-diagnose): a 45s javascript_tool timeout = renderer wedged; healthy probes + healthy backend = the problem is elsewhere (dialog, office machine, stale tab).

1. **Free the owner immediately**: close the wedged mlsscribe tab (`tabs_close_mcp`) — one wedged/dialog-holding tab freezes ALL same-origin tabs; closing it frees the rest instantly.
2. **Revert the suspect change in source** (don't `git revert` the whole commit if it carried unrelated work — surgically restore the block, bump the module's version marker, leave a dated ROLLBACK comment naming the live symptom).
3. **Ship as a NEW build** via mls-build-ship (bump + 253 suite + push + poll live). Rollbacks ride forward-only builds — never rewrite history.
4. **Reload every one of the owner's mlsscribe tabs** via javascript_tool and verify each: new build stamp, signed-in, `appScreen` visible, instant JS response. A tab showing an OLD build after reload = SW race; reload again.
5. **Tell the owner honestly**: what broke, that it was (or wasn't) your change, what you rolled back, and current verified state.
6. **Re-attempt later only with new evidence** + a live soak: deploy, then repeatedly probe responsiveness on the owner's tab over 2-3 minutes (e.g. 2000×getBoundingClientRect timing ≈1ms healthy) with rollback standing by. The b473 wedge turned out to be most plausibly a native dialog, NOT the rolled-back change — the re-attempt (ft-1.1.2) soaked clean; blame accurately.

Keep every rollback + re-attempt logged in the evidence file and MEMORY — the next session must know which theories were disproven.
