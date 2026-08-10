# 019 — The phone app is rebuilt: ph2-1.1.0 → ph3-1.0.0

**Owner, 2026-08-09:** *"the phone app is suppost to do all these thigns and be easy to use and it
just sucks. Learn what it support to do remark from scratch confirm everyhting works uplaod live."*

`feat_mls_phone_ui.js` is a new module. Same filename, same single eager loader, same global
(`window.__mlsPhoneUI`), same engine entry points. Everything above that changed.

## The finding that mattered most, and it was not a drawing problem

Measured in a real browser at 375×812 against the SHIPPED build, before anything was written:

> `#mlsR46VerBanner` — *"MLS Assist is not installed in this browser"* — renders at
> **z-index 2147483100, 230×332, in the middle of the screen**, and `elementFromPoint` proves it
> swallows **3 of the 16 controls on the day screen: the pull button and the FIRST PATIENT OF THE
> DAY.**

It has a phone guard — `body.mls-phone` — and **ph2 removes that class when it mounts**, so the
guard has not fired since the phone app shipped at b975. Its own advice ("Download it from
mlsscribe.com Settings") cannot be followed on a phone: no phone can host the extension.

It is now in the `body.mls-ph3` hide list, next to `#mlsA2hsCard` (which was competing with the
phone app's own install offer for the same `beforeinstallprompt`). **If your lane removes a
`body.mls-phone` guard, the thing it guarded is now your responsibility to re-guard.**

## What changed for anyone reading or testing this module

| | ph2-1.1.0 | ph3-1.0.0 |
|---|---|---|
| frame / body class | `#mlsPh2` / `body.mls-ph2` | `#mlsPh3` / `body.mls-ph3` |
| navigation | three tabs (Today / Visit / Setup) | two screens: **day**, **visit** (pushed, Back in the header) |
| bottom bar | tab bar | **action bar** — ONE contextual primary action |
| account + device | the Setup tab, 161 words of prose | the **menu sheet** behind the header control |
| `state()` | `{tab, mounted, menu}` | `{screen, tab, mounted, menu}` — `tab` aliases `screen` so `newUiOwns()` is untouched |

`mls-connect.js:newUiOwns()` still works unchanged: `installed`, `owns()`, `state().mounted` are all
still published.

## One edit outside the module

`mls-connect.js` phone loader (~:45415) now reads `mls_layout_pref`. `wantPhone()` has read it since
dr-1.5.0, but the loader that actually **fetches** the file did not — so Settings → Integrations →
This device → **"Simple phone app" saved a preference and never loaded anything** on a device that
was not already a handheld. `'full'` now returns early for the same reason in reverse. No pull file
and no extension file was touched.

## Defects fixed that other lanes may have inherited patterns from

- **A boolean that means "dispatched" was read as "done".** `remote.record()` returns `true` once it
  has clicked the host capture button. On a phone whose microphone permission was refused the phase
  stays `idle` and the engine reports success — press the button, nothing happens, nothing is said.
  Every action that claims a phase now **checks for that phase 1.5 s later** and says so when it
  never arrived. Reproduced live: `record()` → `true`, phase → `idle`, and the app now says
  *"MLS did not start recording… permission to use the microphone…"*.
- **A caret guard that guarded the wrong thing.** ph2 skipped the whole repaint while the caret was
  in the transcript, so the engine's live appends stopped reaching the phone — and the next
  keystroke wrote the stale phone copy back over them. **The guard is now on the REBUILD, never on
  the MERGE.** Proven: doctor types `RIGHT` over `right`, engine appends `" Worse when walking."`,
  and both survive in both copies.
- **A repaint signature containing a clock.** `recSecs` was in it, so the visit body was rebuilt
  once a second during a recording and reading the quick history threw you back to the top. The
  clock is a text write into one node now.
- **A badge that counted everything forever.** The check-in badge counts **unread**.
- **An announcement consumed while building the string that announced it.** The arrival banner lived
  in the body and cleared its own flag during render, so the next repaint erased it. It is a header
  pill now, outside the repainted region.
- **A history printed under a name from a different object.** `quickHistory()` now has an identity
  gate: the chart prints only when it ties to the active appointment by portal id, or by name AND
  dob together. Otherwise it says it cannot confirm, and prints nothing.

## Still open, and not this lane's to close

- **`app.html` is a separate, live, store-shipped phone app** (`/app.html`, its own manifest, its own
  four test suites) that can pull a day and read a patient and nothing else. It is reachable only
  from `phone-setup.html` on a phone. Untouched here. If the owner installed THAT to his Home
  Screen, he is in a two-verb app and none of this reaches him — worth confirming with him before
  the next phone round.
- The relay pull has still never been run end to end from a real handheld. Structurally the owner's
  action.
- `scrivara-backend.onrender.com` still must not move. `RENAME_THE_API_HOST.md` is the runbook.
