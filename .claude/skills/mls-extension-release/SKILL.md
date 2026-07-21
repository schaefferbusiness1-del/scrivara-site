---
name: mls-extension-release
description: Release a new MLS Assist extension version (3.0.x pattern) — byte-safe edits, digest stamp, reproducible zip, and the 12+ pins that must move TOGETHER. Proven with the 3.0.1 release on 2026-07-21.
---

# Extension release train (proven: 3.0.1, sha 5c0d678a…78aa)

Source of truth = SITE REPO ROOT (`dispatch-work/claude-commercial-20260717`): background.js, content.js, write_safety_guard.js, manifest.json, etc. (unpublished by allowlist).

1. **Edit sources byte-safely**: background.js is mixed-EOL — node latin1 split/join with same-length checks where possible; NEVER the Edit tool on it.
2. **Version + digest**: bump `manifest.json` "version"; REMOVE the old `version_name` line (the stamper refuses otherwise); then
   `node scripts/extension-core-digest.js --stamp` then `--verify` (digest covers 19 core files, published in version_name, exposed via mlsPong).
3. **Build**: `node scripts/build-extension-zip.js` (python twin exists but python isn't on PATH) → `MLS_Assist_vX.Y.Z.zip` + printed SHA-256. Record the sha.
4. **Move EVERYTHING together** (grep old `MLS_Assist_v<old>.zip` AND the old sha; expect hits in ALL of):
   `extension-version.json` (feed version) · `get-extension.html` (href ×2, label, displayed sha) · ScribeFlow Settings direct link (×2 + label) · `sw.js` exact-lowercase zip passthrough · `_config.yml` include + sha comment · `pages-publication-inventory.json` · `feat_mls_checker.js` SERVER_EXT_VERSION **+ its immutable loader token in mls-connect.js AND mls-connect.staging.js** · test pins: extension-package, public-publication-boundary (incl. ESCAPED-regex zip forms `v3\.0\.0`!), public-release-truth-boundary, extension-reload-helper-contract, immutable-satellite-loader-cache (triplet [file, newToken, oldToken] + staging line).
5. **Gate + ship**: full suite (the boundary test HASHES the published zip bytes; extension-package byte-verifies the 20 root files) → build-bump → push (see mls-build-ship).
6. **Live byte-verify** (mandatory): `curl -s https://mlsscribe.com/MLS_Assist_vX.Y.Z.zip -o /tmp/z.zip && sha256sum /tmp/z.zip` must equal the build sha; curl the feed + get-extension page.
7. **Honesty line**: a byte-verified published package has still NOT "run" — loading into Chrome / Web Store upload is the OWNER'S step. Never claim it works until a machine runs it and pongs the new version. NEVER copy over a RUNNING unpacked extension folder.
