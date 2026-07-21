---
name: mls-build-ship
description: Ship a change to the live MLS site (mlsscribe.com) — build bump, 253-suite gate, deploy, live verification. Use for ANY change to the site repo (dispatch-work/claude-commercial-20260717).
---

# Ship an MLS site change (proven b469→b476, 2026-07-21)

Repo: `C:/Users/Micha/Desktop/MLS_EVERYTHING/dispatch-work/claude-commercial-20260717` (pushes go to `origin HEAD:main`; GitHub Pages deploys in ~40-90s).

1. **Edit** (Edit tool fine for ScribeFlow.html / mls-connect.js / feat_*.js; NEVER for background.js — byte-edit via node latin1 only). `node --check <file>` after JS edits.
2. **Bump the build** — increment bNNN and mls-vNN (SW CACHE) via a node latin1 script with EXACT expected counts (27 replacements total). Template (replace OLD/NEW):
```js
const fs=require('fs');
const files={ 'app-version.json':[['bOLD','bNEW']], 'mls-connect.js':[['bOLD','bNEW']], 'ScribeFlow.html':[['bOLD','bNEW']], 'ScribeFlow-staging.html':[['bOLD','bNEW']],
 'sw.js':[['bOLD','bNEW'],['mls-vOLD','mls-vNEW']],
 'tests/boot-loading-visual-contract.test.js':[['bOLD','bNEW']], 'tests/interaction-performance-contract.test.js':[['bOLD','bNEW']],
 'tests/oldbrowser-compat-runtime.test.js':[['bOLD','bNEW']], 'tests/patient-card-contrast-contract.test.js':[['bOLD','bNEW']],
 'tests/public-preview-integration-contract.test.js':[['bOLD','bNEW']], 'tests/same-tab-session-ui-isolation-runtime.test.js':[['bOLD','bNEW'],['mls-vOLD','mls-vNEW']],
 'tests/startup-hydration-contract.test.js':[['bOLD','bNEW']], 'tests/public-publication-boundary.test.js':[['mls-vOLD','mls-vNEW']] };
for(const [rel,subs] of Object.entries(files)){ let s=fs.readFileSync(rel,'latin1');
 for(const [f,t] of subs){ const n=s.split(f).length-1; if(!n){console.error('MISS '+rel+' '+f);process.exit(1);} s=s.split(f).join(t); }
 fs.writeFileSync(rel,s,'latin1'); }
```
3. **Gate**: `npm.cmd test` → must end "PASS all 253 local regression suites". A pin-test failure usually means YOUR change needs its pin updated deliberately (state why in the pin message) — never delete a pin to pass.
4. **Ship**: `git add -A && git -c core.autocrlf=false commit -F - <<'MSG' ... MSG` then `git push origin HEAD:main`.
5. **Verify live**: poll `curl -s "https://mlsscribe.com/app-version.json?nc=$RANDOM"` until the new bNNN appears (retry ~8×20s; a stall → push an empty commit).
6. **Verify on the owner's real tab** (see mls-live-diagnose): reload the signed-in mlsscribe tab, probe `window.__MLS_AV` + the specific change. NEVER tell the owner it works before this step.

Traps: interrupted tool calls may have PARTIALLY run (verify bump state before re-running); feat files with their OWN `?v=` loader token in mls-connect need that token bumped + its pin tests (live AND staging); `?v=__MLS_AV` files bust automatically; never deploy while the owner is mid-pull.
