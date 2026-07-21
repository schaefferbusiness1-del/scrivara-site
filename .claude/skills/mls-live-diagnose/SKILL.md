---
name: mls-live-diagnose
description: Diagnose "it's broken / can't log in / frozen / slow" reports on the live MLS app through the owner's signed-in Chrome tabs. Probe first, fix second — every such report on 2026-07-21 had a different real cause than described.
---

# Live diagnosis playbook (proven repeatedly 2026-07-21)

Use claude-in-chrome javascript_tool on the owner's mlsscribe tabs (get ids from tabs_context).

**Standard tab probe** (answers most reports in one shot):
```js
(function(){ var out={};
 try{ out.build=window.__MLS_AV; }catch(e){}
 try{ out.hasToken=!!(typeof bkToken==='function'&&bkToken()); }catch(e){}
 try{ out.ns=uns('X').replace('::X',''); }catch(e){}          // 'sf_u::_' = IDENTITY LIMBO (token but unknown account)
 try{ var a=document.getElementById('appScreen'); out.app=a?getComputedStyle(a).display!=='none':null; }catch(e){}
 return JSON.stringify(out); })()
```
**Backend truth** (bash): `curl -s -o /dev/null -w "%{http_code} %{time_total}s" https://scrivara-backend.onrender.com/api/health` and the login endpoint with dummy creds (alive = 401). Identity endpoint is **/api/me** (`/api/auth/me` does NOT exist — 404).

**Decision table** (every one observed live):
- Probe times out 45s → **renderer WEDGED**. Cure: close THAT tab (tabs_close_mcp) — frees every same-origin tab instantly. #1 cause: a native confirm()/prompt() dialog open somewhere (possibly behind a window). Frozen tabs also make OTHER tabs look broken.
- hasToken false + sign-in screen → session evicted; backend usually healthy. Since b471 eviction requires /api/me proof; if it recurs, hunt the 401 source (Render events correlation).
- ns `sf_u::_` → identity limbo (one /api/me failure pre-b470). Reload heals on b470+.
- Old build in out.build → SW served stale shell after a race; plain reload fixes.
- "Broken" not reproducible on any reachable tab + backend healthy → it's the OFFICE machine (old extension 2.9.x / stale cache) — say so with the probe timings as evidence.

**Async JS trap**: async IIFEs return `{}` through the MCP tool. Fire-and-poll instead: kick off the promise storing to `window.__diag`, wait 3-10s, read `JSON.stringify(window.__diag)`.
**Extension bridge probe** (no UI): postMessage `{source:'mls-app', type:'mlsPing', id, requestId}` and listen for `source:'mls-ext'` replies; `mlsAppGotoDate {date}` proves Athena drive; replies echo requestId.
**CSS forensics**: computed `display:'flex'` on a position:fixed element you set to inline-flex is BLOCKIFICATION, not a competing writer. `style.display=''` falls back to the stylesheet (display:none baselines!) — show with an explicit value.
Report findings with the probe numbers; never guess a cause you didn't observe.
