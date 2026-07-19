# Browser vendor boundary

These files are exact browser distributions from pinned official releases. They
are intentionally checked in so the clinical page never executes a library
from a CDN at runtime. `provenance.json` records each official source, package
integrity where applicable, source path, license, and final SHA-256.

The source packages were fetched without installing dependencies:

```powershell
npm.cmd pack chart.js@4.5.1 pdfjs-dist@6.1.200 mammoth@1.12.0 jspdf@4.2.1 --pack-destination <empty-staging-directory> --json
Invoke-WebRequest https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js -OutFile <staging>\xlsx.full.min.js
```

After extracting each tarball (and downloading SheetJS from its official
distribution host), the listed `sourcePath` files were copied verbatim here.
Reproduce and compare with:

```powershell
Get-FileHash vendor\*.js,vendor\*.mjs -Algorithm SHA256
node tests\local-clinical-library-boundary.test.js
```

Do not add a CDN fallback. A missing asset must leave the corresponding feature
unavailable and keep all clinical-page data on MLS-controlled origins.
