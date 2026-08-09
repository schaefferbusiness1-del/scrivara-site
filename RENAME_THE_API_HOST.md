# The last "Scrivara": the API host, and why a search-and-replace would take the product down

Owner, 2026-08-08: *"fix what u have to get ride of the schribva anywhre it
sohudl always saya mlsscribe."*

Everything a person can read is done, and so is every identifier this repo
controls — the bundle id, the Android Java package, the storage keys, the npm
package, the CI artifact names, the signing profile, the gradle marker, the
source comments. **One string is left, in 186 places:**

```
https://scrivara-backend.onrender.com
```

## Why it did not move with the rest

It is not a brand. It is the **address of the running server**, and it answered
`HTTP 200` while this was written:

```
$ curl https://scrivara-backend.onrender.com/api/health
{"ok":true,"revision":"03e5b2ea57c3","capabilities":{"phiEnabled":true, ...
```

Changing that string in the client does not rename the server. It points every
login, every Athena pull, every note save and every relay job at a hostname that
answers **404**:

```
$ curl -o /dev/null -w '%{http_code}' https://mlsscribe-backend.onrender.com/api/health
404
```

That is not a rename, it is a total outage — and one that would look exactly
like a successful deploy until the first doctor tried to sign in. So the client
follows the server here, never the other way round.

The good news is in that 404: **the name is free.** Nothing is deployed at
`mlsscribe-backend.onrender.com`, so it is available to claim.

## The two ways to do it, both ~5 minutes in a browser

### Option A — rename the Render service (simplest, one-way)

1. Render dashboard → the `scrivara-backend` service → **Settings** → **Name** →
   change to `mlsscribe-backend` → Save.
2. Render reissues the URL as `https://mlsscribe-backend.onrender.com`.
   **The old `onrender.com` URL stops working**, so this is a hard cutover:
   nothing can call the API between the rename and the client deploy.
3. Confirm it answers:
   `curl https://mlsscribe-backend.onrender.com/api/health` → `{"ok":true,...}`
4. Tell me, and I flip all 186 references and ship in one build.

⚠️ **The extension is the reason this needs care.** `manifest.json` lists the
host in `host_permissions`, and an installed extension keeps the OLD manifest
until the user updates it. A hard cutover breaks every Assist extension in the
field until each one is updated — including the office computer that runs every
relayed pull.

### Option B — attach a custom domain first (no outage, recommended)

1. Render → service → **Settings** → **Custom Domains** → add
   `api.mlsscribe.com`.
2. Add the CNAME Render gives you at the mlsscribe.com DNS host.
3. Wait for Render to show it verified + certificate issued (usually minutes).
4. Confirm: `curl https://api.mlsscribe.com/api/health` → `{"ok":true,...}`
5. **Both hostnames now serve the same service.** Tell me, and I flip the client
   to `api.mlsscribe.com` and ship. Old extensions keep working on the old host
   until they update, so nothing breaks at any moment.
6. Once no traffic is left on the old host, it can be dropped.

Option B is the one I would take: it is the same end state, it never has a
window where the product is down, and it gets the brand off the address entirely
rather than trading one `onrender.com` name for another.

## What I will change when you say go

| where | what |
|---|---|
| `mls-connect.js`, `app.html`, `ScribeFlow*.html`, `index*.html`, `patient-portal.html` | the API base |
| `mobile/app.config.json` | `apiBase` |
| `app.html` CSP | `connect-src` — the app is bundled, so this ONE host is its entire network surface |
| `manifest.json` + every `extension-candidates/*/manifest.json` | `host_permissions` |
| `background.js` | the backend origin allow-list |
| `tests/extension-backend-origin-security.test.js`, `tests/one-product-name.test.js` | the pins, including deleting the exemption this file exists to explain |

The exemption in `tests/one-product-name.test.js` asserts the old host is still
**present**, on purpose: without it, a later "finish the rename" sweep would go
green while taking the product down. That assertion is the last thing to be
removed, and only after step 4 above passes.

## Also owner-only: the GitHub repo name

`scrivara-site` appears in a handful of source comments describing where a file
lives. Renaming the repo is a GitHub setting (Settings → Rename); GitHub keeps
redirects for the old name, so clones and Pages keep working. I left the
comments alone because they correctly name the repo as it is today — say the
word once it is renamed and I will sweep them.
