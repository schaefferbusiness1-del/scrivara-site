# 014 — URGENT: saving ONE template WIPES the doctor's whole library. Proven live on b833.

**From:** owner-directed live-test lane, 2026-07-31, on mlsscribe.com signed in as the owner.
**Severity:** data loss, silent, on the primary Templates flow. The owner is taking this commercial.
**Status:** root-caused with receipts below. NOT yet fixed at the time of writing — I am fixing it
in `fix/templates-upload-and-overlaps`. If you own any of these files, coordinate before editing:
`feat_mls_template_library.js`, `ScribeFlow.html` (#templatesModal), `feat_mls_opnote_templates_ui.js`,
`feat_upload_templates.js`.

---

## What the doctor does, and what actually happens

1. Templates → picks a file → text extracts fine, name auto-fills. **This part works.**
2. Clicks **💾 Save template**. → *Nothing visibly happens.* No toast. Form keeps its contents.
3. What actually happened: `feat_mls_template_library.js:221` wraps `saveTemplateFromForm`. When
   `hosted()` is true it does NOT save. It calls `previewImport({fromForm:true})`, which renders an
   "Import preview — nothing saved yet / Commit one recoverable version" panel into `#tplFormResult`.
   **That panel rendered at y=3004 in a 936px viewport** — ~3,000px below the fold. `scrollIntoView`
   is called on it and does not land. The doctor cannot see the step they must complete.
4. If they do find and click **Commit**: banner says **"Import completed · added: 1"** and the form
   clears — but `localStorage[uns('templates')]` is UNCHANGED and the new template is **not in the
   Saved-templates list**. Success reported, nothing delivered.
5. The only way to land it is the **"Activate imported set"** button. And that is the trap:

```
before activate:  8 templates on the device
after  activate:  1 template   <-- the set contained ONLY the newly saved one
```

`applySet()` → `originals.setTemplates(cloneTemplates(set.templates))` **replaces** the device list
with the set's contents. Saving one template through the cloud path builds a one-template set, so
activating it deletes everything else. `setTemplates` then fires `syncPrefsToServer()`, so the
**server copy is overwritten too** — I verified `/api/prefs` came back with count 1. Both copies gone.

## Measured receipts (live, b833, owner's Chrome)

| step | observed |
|---|---|
| upload extract | name auto-filled, 1090 chars — OK |
| Save clicked | no toast, form not cleared, nothing persisted |
| preview panel | exists, visible, **y = 3004**, viewport height 936 |
| Commit clicked | "Import completed · added: 1", device count **8 → 8**, list still 8 rows |
| Activate clicked | device count **8 → 1**, `/api/prefs` templates count **1** |

The owner's library was restored by hand afterwards to 6 (3 shipped `pkg_*` templates recovered
verbatim from `sf_u::qa.portal.20260714@mlsscribe.test::templates`, 3 `Starter — …` re-seeded from
`feat_mls_uxpack1.js:190-197`). Two QA fixtures dated 20260722 were disposable and not restored.

## Reproduction

```
open mlsscribe.com/ScribeFlow.html signed in → Prep op notes → Templates tab
fill #tplName + #tplText → click 💾 Save template
measure: document.getElementById('tplFormResult').getBoundingClientRect().top
```

## The two defects to fix, separately

1. **`applySet` must never silently delete device templates.** Activating a set that does not
   contain the device's templates is a destructive merge presented as an activation. It needs either
   a union, or an explicit "this will replace N templates" confirmation naming the count.
2. **The form Save must save.** The cloud preview/commit round-trip is a reasonable *bulk import*
   step; it is the wrong shape for "I typed one template and pressed Save". The wrapper should fall
   through to the proven device save unless a cloud set is genuinely active, and any preview it does
   render must be placed where the doctor is looking, not 3,000px below.

## Also measured in the same pass (lower severity, same screen)

- **Upload is not reachable without scrolling.** ⬆ Upload template sits at y=1906 and the bulk
  📑 Upload templates at y=2446 — 2–3 full screens down. Owner's words: "uploading templates needs
  to be at the top and simple to do." First screen shows only the library.
- **Four competing upload entry points**: `#tplFileInput` button, `#tplMultiFileInput` button, two
  drop zones (`#tplDropZone`, `#tplMultiDrop`), plus `#mlsUplTplBtn` injected by
  `feat_upload_templates.js`, plus `#tpfReupload`.
- **`#tplActiveSel` is occluded by `#mlsDock`** at scrollTop 640 (hit-test: `elementFromPoint`
  returns `#mlsDock[nav]`). `💾 Save template` and `Clear` go under `.opr-top` at deep scroll.
- **NOT a real defect — do not "fix" it:** children of the collapsed `#tpfFold` `<details>`
  (`#tpfReupload`, `#tpfReAll`, `#tpfMatchBtn`, the Re-process/AI-keywords/Delete row) report
  `display:flex`, `visibility:visible` and full-size rects while the details is closed, so a
  naive rect-intersection overlap scan reports ~13 false overlaps. `elementFromPoint` at their
  centres returns the element *underneath*, so they neither paint nor take clicks. Hit-test before
  believing any overlap report on this screen.
