'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const stagingHtml = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'provenance.json'), 'utf8'));

const productionAdjunctRequirements = new Map([
  ['mls-connect.js', ['xlsx', 'jspdf']],
  ['feat_after_visit_summary.js', ['jspdf']],
  ['feat_comp_report.js', ['xlsx']],
  ['feat_fullhistory_pdf.js', ['jspdf']],
  ['feat_mls_assistant_exact.js', []],
  ['feat_mls_outcome_pdf.js', ['jspdf']],
  ['feat_mls_studygroups.js', ['xlsx', 'jspdf']],
  ['feat_mls_study_request.js', ['jspdf']],
  ['mls-opnote-pro.js', ['jspdf']],
  ['mls-outcome-study.js', ['xlsx']],
  ['mls-procedure-report.js', ['jspdf']]
]);

const freshHardcodedLoaderTags = new Map([
  ['mls-outcome-study.js', '20260731lib4'],
  ['mls-opnote-pro.js', '20260731lib4'],
  ['mls-procedure-report.js', '20260731lib4'],
  ['feat_mls_assistant_exact.js', '20260725asst217'],
  ['feat_mls_outcome_pdf.js', '20260731lib4'],
  ['feat_mls_studygroups.js', '20260722sg1c6'],
  ['feat_comp_report.js', '20260718pr5'],
  ['feat_mls_study_request.js', '20260723sr233']
]);

const stagingAdjunctRequirements = new Map([
  ['mls-opnote-pro.staging.js', ['jspdf']],
  ['mls-outcome-study.staging.js', ['xlsx']],
  ['mls-procedure-report.staging.js', ['jspdf']]
]);

const freshStagingLoaderTags = new Map([
  ['mls-opnote-pro.staging.js', '20260718stglib1'],
  ['mls-outcome-study.staging.js', '20260718stglib1'],
  ['mls-procedure-report.staging.js', '20260718stglib1']
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function allAssets(packages) {
  return packages.flatMap((pkg) => pkg.assets || [{
    sourcePath: pkg.sourcePath,
    asset: pkg.asset,
    sha256: pkg.sha256
  }]);
}

function packageAsset(packageName) {
  const pkg = provenance.packages.find((item) => item.package === packageName);
  assert(pkg, `missing provenance package: ${packageName}`);
  assert(!pkg.assets, `${packageName} must identify one browser asset for adjunct loaders`);
  return `vendor/${pkg.asset}?v=${pkg.sha256.slice(0, 16)}`;
}

function extractReachableLocalJs(source) {
  const refs = new Set();
  for (const match of source.matchAll(/(["'`])([^"'`\r\n]*?\.js)(?:\?[^"'`\r\n]*)?\1/g)) {
    const raw = match[2].replace(/\\/g, '/');
    if (/^(?:https?:|data:|blob:|javascript:|\/\/)/i.test(raw)) continue;
    const rel = raw.replace(/^\/+/, '');
    if (!rel || rel.startsWith('vendor/') || rel.includes('../') || /\.staging\.js$/i.test(rel)) continue;
    const absolute = path.resolve(root, rel);
    if (path.dirname(absolute) !== root || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    refs.add(rel);
  }
  return refs;
}

function buildProductionGraph(entrySource) {
  const graph = new Map();
  const queued = [...extractReachableLocalJs(entrySource)];
  const seen = new Set();
  while (queued.length) {
    const rel = queued.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    graph.set(rel, source);
    for (const child of extractReachableLocalJs(source)) {
      if (!seen.has(child)) queued.push(child);
    }
  }
  return graph;
}

function assertNoRemoteExecutableOrFont(source, label) {
  assert(!/(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|cdn\.skypack\.dev|fonts\.googleapis\.com|fonts\.gstatic\.com)/i.test(source), `${label} contains a remote executable/font host`);
  assert(!/@import[^;\n]{0,400}(?:https?:)?\/\//i.test(source), `${label} contains a remote CSS import`);
  for (const match of source.matchAll(/https?:\/\/[^\s"'`<>\\)]+/gi)) {
    const raw = match[0].replace(/[;,]+$/, '');
    let url;
    try { url = new URL(raw); } catch (_) { continue; }
    const executableOrFont = /\.(?:js|mjs|cjs|css|woff2?|ttf|otf)(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
    assert(!executableOrFont, `${label} contains a remote executable/font URL: ${raw}`);
  }
}

const firstScript = html.search(/<script\b/i);
const cspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i);
assert(cspMatch, 'ScribeFlow must declare a CSP before executing scripts');
assert(firstScript > html.indexOf(cspMatch[0]), 'CSP must appear before the first script');
const csp = cspMatch[1];
assert(/script-src\s+'self'\s+'unsafe-inline'/.test(csp), 'script-src must restrict files to same-origin while legacy inline code is migrated');
assert(!/unsafe-eval/.test(csp), 'CSP must not permit eval-like script execution');
assert(/worker-src\s+'self'\s+blob:\s*(?:;|$)/.test(csp), 'workers must allow only same-origin files and same-document blob URLs');
assert(!/worker-src[^;]*(?:https?:|data:)/.test(csp), 'workers must not allow remote or data-URL execution');
assert(/object-src\s+'none'/.test(csp), 'plugins must be disabled');
assert(/base-uri\s+'none'/.test(csp), 'base URL injection must be disabled');

assert(!/\bnew\s+Function\s*\(/.test(html), 'clinical page must not require unsafe-eval');
assert(!/(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)/i.test(html), 'clinical page must not contain executable CDN library references');
assert(!/(?:\.src\s*=|setAttribute\(\s*['"]src['"]\s*,)\s*['"]https?:\/\//i.test(html), 'runtime script sources must not be remote');

for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
  assert(!/^(?:https?:)?\/\//i.test(match[1]), `remote script element is forbidden: ${match[1]}`);
}

assert.strictEqual(provenance.schemaVersion, 1, 'unexpected provenance schema');
assert.strictEqual(provenance.packages.length, 5, 'all five pinned packages must be documented');
const expectedPackages = new Map([
  ['chart.js', '4.5.1'],
  ['xlsx', '0.20.3'],
  ['pdfjs-dist', '6.1.200'],
  ['mammoth', '1.12.0'],
  ['jspdf', '4.2.1']
]);
for (const pkg of provenance.packages) {
  assert.strictEqual(expectedPackages.get(pkg.package), pkg.version, `${pkg.package} version drift`);
  if (pkg.package === 'xlsx') {
    assert.strictEqual(pkg.distribution, 'official-sheetjs-cdn', 'SheetJS must record its official distribution channel');
    assert.strictEqual(pkg.source, 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'SheetJS source drifted from its official pinned browser build');
  } else {
    assert(/^https:\/\/registry\.npmjs\.org\//.test(pkg.source), `${pkg.package} source must be the npm registry tarball`);
    assert(/^sha512-/.test(pkg.npmIntegrity), `${pkg.package} npm integrity is missing`);
  }
  assert(pkg.license, `${pkg.package} license is missing`);
  expectedPackages.delete(pkg.package);
}
assert.strictEqual(expectedPackages.size, 0, 'a required package is missing from provenance');

const assets = allAssets(provenance.packages);
assert.strictEqual(assets.length, 6, 'five libraries plus the PDF worker must be pinned');
for (const asset of assets) {
  assert(/^[A-Za-z0-9._-]+\.m?js$/.test(asset.asset), `unsafe asset name: ${asset.asset}`);
  assert(/^[a-f0-9]{64}$/.test(asset.sha256), `invalid SHA-256 for ${asset.asset}`);
  const file = path.join(root, 'vendor', asset.asset);
  assert(fs.existsSync(file), `missing local vendor asset: ${asset.asset}`);
  assert.strictEqual(sha256(file), asset.sha256, `vendor asset digest mismatch: ${asset.asset}`);
  const runtimeRef = `vendor/${asset.asset}?v=${asset.sha256.slice(0, 16)}`;
  assert(html.includes(runtimeRef), `ScribeFlow is not pinned to ${runtimeRef}`);
  assert(stagingHtml.includes(runtimeRef), `ScribeFlow-staging is not pinned to ${runtimeRef}`);
}

assert.deepStrictEqual(
  fs.readdirSync(path.join(root, 'vendor'), { withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => entry.name).sort(),
  assets.map((asset) => asset.asset).concat(['README.md', 'provenance.json']).sort(),
  'vendor root must contain only current runtime assets and their provenance metadata'
);

const expectedRuntimeRefs = new Map([
  ['xlsx', packageAsset('xlsx')],
  ['jspdf', packageAsset('jspdf')]
]);
const approvedVendorRefs = new Set(assets.map((asset) => `vendor/${asset.asset}?v=${asset.sha256.slice(0, 16)}`));
const productionGraph = buildProductionGraph(html);
const connect = productionGraph.get('mls-connect.js');
const stagingConnect = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

for (const [file, tag] of freshHardcodedLoaderTags) {
  assert(connect.includes(`${file}?v=${tag}`) || connect.includes(`${file}\";`) && connect.includes(`\"?v=${tag}\"`), `${file} loader cache tag was not advanced to ${tag}`);
}
assert(/feat_after_visit_summary\.js[^\n]+__MLS_AV/.test(connect), 'after-visit summary must inherit the final app cache version');
assert(/feat_fullhistory_pdf\.js[\s\S]{0,300}__MLS_AV/.test(connect), 'full-history PDF must inherit the final app cache version');
assert(stagingHtml.includes('mls-connect.staging.js'), 'staging entry point must reach its adjunct loader bundle');
for (const [file, tag] of freshStagingLoaderTags) {
  assert(stagingConnect.includes(`${file}?v=${tag}`), `${file} staging loader cache tag was not advanced to ${tag}`);
}

for (const [file, requiredPackages] of productionAdjunctRequirements) {
  assert(productionGraph.has(file), `${file} is not reachable from the production ScribeFlow dependency graph`);
  const source = productionGraph.get(file);
  assertNoRemoteExecutableOrFont(source, file);
  for (const packageName of requiredPackages) {
    const runtimeRef = expectedRuntimeRefs.get(packageName);
    assert(source.includes(runtimeRef), `${file} is not pinned to ${runtimeRef}`);
  }
  for (const match of source.matchAll(/vendor\/[A-Za-z0-9._-]+\.js(?:\?v=[A-Za-z0-9._-]+)?/g)) {
    assert(approvedVendorRefs.has(match[0]), `${file} uses an unapproved or unpinned vendor reference: ${match[0]}`);
  }
}

for (const [file, source] of productionGraph) assertNoRemoteExecutableOrFont(source, file);
assertNoRemoteExecutableOrFont(stagingHtml, 'ScribeFlow-staging.html');

for (const [file, requiredPackages] of stagingAdjunctRequirements) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assertNoRemoteExecutableOrFont(source, file);
  for (const packageName of requiredPackages) {
    const runtimeRef = expectedRuntimeRefs.get(packageName);
    assert(source.includes(runtimeRef), `${file} is not pinned to ${runtimeRef}`);
  }
}

const reachableSource = html + '\n' + stagingHtml + '\n' + stagingConnect + '\n' + [...productionGraph.values()].join('\n');
assert(!/(?:chart\.umd-4\.4\.1|xlsx\.full-0\.18\.5|pdf(?:\.worker)?-3\.11\.174|mammoth\.browser-1\.6\.0|jspdf\.umd-2\.5\.1)/.test(reachableSource), 'a retired vulnerable/outdated vendor build remains reachable');

const assistant = productionGraph.get('feat_mls_assistant_exact.js');
assert(!/@import/i.test(assistant), 'assistant must not import remote typography');
assert(assistant.includes("font-family:Georgia,'Times New Roman',serif"), 'assistant must retain an explicit local/system serif stack');

const expectedLicenses = provenance.packages.map((pkg) => {
  const prefix = pkg.package === 'pdfjs-dist' ? 'pdfjs-dist' : pkg.package;
  const extension = pkg.package === 'chart.js' ? 'md' : 'txt';
  return `${prefix}-${pkg.version}-LICENSE.${extension}`;
});
assert.deepStrictEqual(
  fs.readdirSync(path.join(root, 'vendor', 'licenses')).sort(),
  expectedLicenses.sort(),
  'vendor licenses must exactly match the current pinned packages'
);

assert(/url\.protocol!==page\.protocol\s*\|\|\s*url\.host!==page\.host/.test(html), 'loader must enforce same protocol and host');
assert(html.includes("!/\\/vendor\\/[A-Za-z0-9._-]+\\.m?js$/.test(url.pathname)"), 'loader must restrict .js/.mjs executable paths to the vendor directory');
assert(/import\s*\(\s*_mlsLocalVendorUrl\(['"]pdfjs['"]\)\s*\)/.test(html), 'PDF.js must load its same-origin ES module with dynamic import');
assert(/GlobalWorkerOptions\.workerSrc=_mlsLocalVendorUrl\('pdfWorker'\)/.test(html), 'PDF worker must use the guarded local URL');
function assertPdfLoadingTaskLifecycle(source, label) {
  const start = source.indexOf('async function extractPdfText(file){');
  assert(start >= 0, `${label} PDF extraction function is missing`);
  const block = source.slice(start, start + 2000);
  assert(
    /const\s+task\s*=\s*pdfjsLib\.getDocument\(\{data:buf,isEvalSupported:false\}\);/.test(block),
    `${label} PDF extraction must retain the PDF.js loading task`
  );
  assert(
    /try\s*\{[\s\S]*?await\s+task\.promise[\s\S]*?\}\s*finally\s*\{[\s\S]*?await\s+task\.destroy\(\)/.test(block),
    `${label} PDF extraction must destroy the loading task in finally`
  );
}
assertPdfLoadingTaskLifecycle(html, 'production');
const pdfDocumentCalls = [...html.matchAll(/getDocument\s*\(\s*\{([\s\S]{0,500}?)\}\s*\)/g)];
assert(pdfDocumentCalls.length > 0, 'clinical PDF import path is missing');
for (const call of pdfDocumentCalls) assert(/isEvalSupported\s*:\s*false/.test(call[1]), 'every PDF.js getDocument call must disable eval');
assert(!/fallback[^\n]{0,100}https?:\/\//i.test(html), 'a remote library fallback is forbidden');

assert(/url\.protocol!==page\.protocol\s*\|\|\s*url\.host!==page\.host/.test(stagingHtml), 'staging loader must enforce same protocol and host');
assert(stagingHtml.includes("!/\\/vendor\\/[A-Za-z0-9._-]+\\.m?js$/.test(url.pathname)"), 'staging loader must restrict .js/.mjs executable paths to the vendor directory');
assert(/import\s*\(\s*_mlsLocalVendorUrl\(['"]pdfjs['"]\)\s*\)/.test(stagingHtml), 'staging PDF.js must load its same-origin ES module with dynamic import');
assert(/GlobalWorkerOptions\.workerSrc=_mlsLocalVendorUrl\('pdfWorker'\)/.test(stagingHtml), 'staging PDF worker must use the guarded local URL');
assertPdfLoadingTaskLifecycle(stagingHtml, 'staging');
const stagingPdfDocumentCalls = [...stagingHtml.matchAll(/getDocument\s*\(\s*\{([\s\S]{0,500}?)\}\s*\)/g)];
assert(stagingPdfDocumentCalls.length > 0, 'staging clinical PDF import path is missing');
for (const call of stagingPdfDocumentCalls) assert(/isEvalSupported\s*:\s*false/.test(call[1]), 'every staging PDF.js getDocument call must disable eval');
assert(!/fallback[^\n]{0,100}https?:\/\//i.test(stagingHtml), 'a staging remote library fallback is forbidden');

console.log(`PASS local clinical library boundary: ${assets.length} same-origin assets across ${productionGraph.size} reachable production scripts`);
