# `1p-avatar-model/` — the on-device face landmark model (avml-1.0.0, 2026-08-18)

This folder is the **only** third-party runtime the /1p avatar matcher loads, and it
exists for one measured reason.

## Why it is here

`1p-feat_mls_avatar.js` reads fourteen appearance traits from a portrait. Before this
folder existed, five of those fourteen — `beard`, `glasses`, `hairline`, `browCol`,
`faceShape` — were **structurally unclaimable** on an ordinary doctor: the pixel reader
pushes `beard` only for a beard, `glasses` only for frames, `hairline` only for a
receding one, so a clean-shaven doctor with no glasses could not score above nine of
fourteen however good his photograph was. The previous lane measured that ceiling
(`tests/1p-avatar-capture-readability-proof.js`) and wrote, correctly, that turning
"I did not see a beard" into `beard: 'none'` needs **positive evidence of the absence**
— a real jawline to sample, not a guess at where the jaw probably is.

A 68-point face landmark model supplies exactly that: the jaw contour, the brow line,
the eye corners, the nose and the lip outline, in image pixels. With those, "no beard"
becomes a measurement (the chin skin matches the cheek skin) instead of an assumption.

## What is here, and where each byte came from

Downloaded 2026-08-18. Nothing is fetched at runtime; nothing leaves the browser.

| file | bytes | sha256 |
| --- | --- | --- |
| `face-api-1.7.15.js` | 1333943 | `0160f7af3a8c78cece45c7ecc765383bad74becfd438bb787cdd627b2d6f2cf6` |
| `face_landmark_68_model-weights_manifest.json` | 8489 | `4a5058cee2e126a313462085b3750a95d0421ac490b620f5514fc38cf9dae99f` |
| `face_landmark_68_model.weights` | 356840 | `4611ef65c87d836d03d684b30eec4d195d8b219fa1dd58fc58945831c6b9299b` |
| `tfjs-backend-wasm-simd.wasm` | 424594 | `77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b` |
| `tfjs-backend-wasm.wasm` | 311123 | `70a5d516060464e5269f01c74bac1772d6b8ab6cb612acf16b5cdaf61f78d892` |
| `tiny_face_detector_model-weights_manifest.json` | 3223 | `fa86dcb1b43a8939348598c3c988d14de658e1812118ff41d6846587cf09039b` |
| `tiny_face_detector_model.weights` | 193321 | `b7503ce7df31039b1c43316a9b865cab6a70dd748cc602d3fa28b551503c3871` |

**Total 2 631 533 bytes (2.51 MiB)** — the budget for this folder is 8 MiB and
`tests/1p-avatar-model-bundle.test.js` fails if it is exceeded, or if any byte above
changes without the digest being moved on purpose.

### Sources

| file | source URL |
| --- | --- |
| `face-api-1.7.15.js` | `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js` |
| `tfjs-backend-wasm.wasm` | `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/tfjs-backend-wasm.wasm` |
| `tfjs-backend-wasm-simd.wasm` | `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/tfjs-backend-wasm-simd.wasm` |
| `tiny_face_detector_model.weights` | `https://raw.githubusercontent.com/vladmandic/face-api/master/model/tiny_face_detector_model.bin` |
| `tiny_face_detector_model-weights_manifest.json` | `…/model/tiny_face_detector_model-weights_manifest.json` |
| `face_landmark_68_model.weights` | `https://raw.githubusercontent.com/vladmandic/face-api/master/model/face_landmark_68_model.bin` |
| `face_landmark_68_model-weights_manifest.json` | `…/model/face_landmark_68_model-weights_manifest.json` |

### The one edit made to an upstream file

The two `*-weights_manifest.json` files are upstream bytes with **one** substitution:
their `paths` entries read `…_model.bin` upstream and read `…_model.weights` here, and
the shard files are renamed to match. That is not cosmetic — `_config.yml` excludes
`*.[Bb][Ii][Nn]` and `**/*.[Bb][Ii][Nn]` from GitHub Pages publication (the b948
deploy-failure rule), so a weight shard named `.bin` would be committed, tested green
locally, and then **404 in the browser** because Pages never served it. `.weights` is
outside every exclusion glob in `_config.yml`.

## Licences

* `face-api-1.7.15.js` and both `*_model.weights` / `*-weights_manifest.json` pairs —
  **MIT**, © Vladimir Mandic (fork) and © Vincent Mühler (original `face-api.js` and its
  trained weights). Full text: `LICENSE-face-api.txt`.
* `tfjs-backend-wasm*.wasm`, and the TensorFlow.js runtime **bundled inside**
  `face-api-1.7.15.js` — **Apache-2.0**, © the TensorFlow Authors. Full text:
  `LICENSE-tensorflow.txt`.

Both licences are redistribution-permissive and require the notices kept with the
copies; that is what the two `LICENSE-*.txt` files beside this one are for.

## How it is loaded

* **Lazily, never at page boot.** `faceModelReady()` in `1p-feat_mls_avatar.js` injects
  `1p-avatar-model/face-api-1.7.15.js` the first time the doctor opens avatar Setup.
  A page that never opens Setup downloads none of these bytes.
* **Same-origin only.** Every path is relative, so it resolves to `/1p-avatar-model/…`
  under both `/1pScribeFlow.html` (no `<base>`) and `/1p/` (whose `<base href="/1p">`
  drops its own last segment). No CDN, no `connect-src` change.
* **Threads deliberately off.** `WASM_HAS_MULTITHREAD_SUPPORT` is forced `false` before
  the backend initialises, so tfjs can only ever choose between the two `.wasm` binaries
  present here. The 435 KB `tfjs-backend-wasm-threaded-simd.wasm` is therefore **not**
  shipped and can never be requested; shipping a file nothing can fetch would be 435 KB
  of unreviewed published surface.
* **It needs `'wasm-unsafe-eval'`.** Instantiating a WebAssembly module is script
  execution as far as CSP is concerned. The two /1p shells carry that source expression;
  production `ScribeFlow.html` deliberately does not, because production runs no wasm.

## What happens when it does not load

Nothing breaks and nothing is guessed. `faceLandmarkEvidence()` returns `null`, the
matcher falls back to the avfit pixel ladder exactly as it behaved before this folder
existed, and the Setup note says so in plain words rather than silently scoring lower.
