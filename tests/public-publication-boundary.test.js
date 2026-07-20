'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const PUBLIC_HTML = [
  '404.html',
  'appointment.html',
  'assist.html',
  'assist-privacy.html',
  'best-doctors-optout.html',
  'booking.html',
  'expert.html',
  'gbp-setup.html',
  'get-extension.html',
  'index.html',
  'intake.html',
  'lawyers.html',
  'patient-portal.html',
  'phone.html',
  'privacy.html',
  'review-finder.html',
  'ScribeFlow.html',
  'terms.html'
];

const PUBLIC_ASSETS = [
  'feat_mls_force_full_phone.js',
  'phone-manifest.json',
  'public-preview-policy.js',
  'public-preview-runtime.js'
];

const PUBLIC_VENDOR_ASSETS = [
  'vendor/chart.umd-4.5.1.js',
  'vendor/xlsx.full-0.20.3.min.js',
  'vendor/pdf-6.1.200.min.mjs',
  'vendor/pdf.worker-6.1.200.min.mjs',
  'vendor/mammoth.browser-1.12.0.min.js',
  'vendor/jspdf.umd-4.2.1.min.js'
];

const PUBLIC_VENDOR_REQUESTS = [
  'vendor/chart.umd-4.5.1.js?v=ecc3cd1eeb8c34d2',
  'vendor/xlsx.full-0.20.3.min.js?v=cc015130aa8521e7',
  'vendor/pdf-6.1.200.min.mjs?v=4ba2f15599b03fde',
  'vendor/pdf.worker-6.1.200.min.mjs?v=2ab9e09667296dab',
  'vendor/mammoth.browser-1.12.0.min.js?v=5d4c0e7c9165d70b',
  'vendor/jspdf.umd-4.2.1.min.js?v=e6551fcdc32f09d6'
];
assert.deepStrictEqual(PUBLIC_VENDOR_REQUESTS.map((entry) => entry.split('?')[0]), PUBLIC_VENDOR_ASSETS, 'published vendor requests and files must stay synchronized');

const RETIRED_ASSETS = [
  'feat_mls_best_doctors.js',
  'feat_mls_review_request.js',
  'legal-connect-ui.js',
  'legal-chart-fill-ui.js',
  'legal-tracker.js',
  'feat_mls_expert_top.js',
  'feat_mls_legal_exact.js',
  'feat_mls_legal_pay_setup.js',
  'feat_mls_legal_paywidget.js',
  'feat_mls_legalpack.js',
  'feat_mls_navfeat_keep.js',
  'feat_mls_staff_hub.js',
  'feat_mls_team_exact.js',
  'manifest.json',
  'background.js',
  'inject_dom.js',
  'destination_teach_navigation_guard.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'mls-popup.js',
  'mls-popup.css',
  'offscreen.html',
  'offscreen.js',
  'feat_codes_driver.js',
  'ext_reviews_reader.js',
  'write_safety_guard.js',
  'review_screen.js',
  'teach_destination_memory.js',
  'expert-marketplace-ui.js'
];

const RETIRED_HTML = [
  '_compare.html',
  '_dz_aistudio.html',
  '_dz_analysis.html',
  '_dz_calendar.html',
  '_dz_help.html',
  '_dz_history.html',
  '_dz_legal.html',
  '_dz_login.html',
  '_dz_orders.html',
  '_dz_patients.html',
  '_dz_recs.html',
  '_dz_settings.html',
  '_dz_team.html',
  '_dz_visit.html',
  '_ps_preview.html',
  'AuthPilot.html',
  'easy-book.html',
  'index-staging.html',
  'legal-connect.html',
  'mls-best-doctors-admin.html',
  'mls-best-doctors.html',
  'mls-doctor-awards.html',
  'mls-marketing.html',
  'mls-marketing-console.html',
  'mls-widgets.html',
  'patient-portal-staging.html',
  'patient-review.html',
  'popup.html',
  'offscreen.html',
  'ScribeFlow_test.html',
  'ScribeFlow_Website.html',
  'ScribeFlow-staging.html',
  'send-portal-invite.html'
];

function sorted(values) {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function parseTopLevelLists(yaml) {
  const result = Object.create(null);
  let section = '';
  for (const line of yaml.split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z][\w-]*):\s*$/);
    if (key) {
      section = key[1];
      if (!result[section]) result[section] = [];
      continue;
    }
    const item = line.match(/^\s{2}-\s+"([^"]+)"\s*$/);
    if (item && section) result[section].push(item[1]);
  }
  return result;
}

const config = read('_config.yml');
const gitignore = read('.gitignore');
const lists = parseTopLevelLists(config);
const includes = lists.include || [];
const excludes = lists.exclude || [];
const includeSet = new Set(includes);
const excludeSet = new Set(excludes);

assert(!fs.existsSync(path.join(root, '.nojekyll')), '.nojekyll bypasses the Jekyll publication boundary and must stay deleted');
assert.match(config, /^theme:\s*null\s*$/m, 'GitHub Pages default theme assets must stay disabled outside the reviewed publication inventory');
assert.strictEqual(includes.length, includeSet.size, '_config.yml include entries must be unique');
assert.strictEqual(excludes.length, excludeSet.size, '_config.yml exclude entries must be unique');
for (const artifactDir of [
  'tests/live-a11y-artifacts/',
  'tests/live-athena-smart-ui-artifacts/',
  'tests/live-phone-artifacts/',
  'tests/live-sensitive-workflow-artifacts/',
  'tests/live-smoke-artifacts/',
  'tests/live-visible-controls-artifacts/',
]) {
  assert(gitignore.split(/\r?\n/).includes(artifactDir), `public repository must ignore local live-evidence tree: ${artifactDir}`);
}

for (const required of [
  '*.[Hh][Tt][Mm][Ll]', '**/*.[Hh][Tt][Mm][Ll]', '*.[Zz][Ii][Pp]', '**/*.[Zz][Ii][Pp]',
  '*.[Ss][Tt][Aa][Gg][Ii][Nn][Gg].[Jj][Ss]', '**/*.[Ss][Tt][Aa][Gg][Ii][Nn][Gg].[Jj][Ss]',
  '*_[Ss][Tt][Aa][Gg][Ii][Nn][Gg]_*.[Jj][Ss]', '**/*_[Ss][Tt][Aa][Gg][Ii][Nn][Gg]_*.[Jj][Ss]',
  '*_[Aa][Pp][Pp][Ee][Nn][Dd]_*.[Jj][Ss]', 'bg_worker_block.[Jj][Ss]',
  ...RETIRED_ASSETS,
  '.bundle/', '.jekyll-cache/', '.sass-cache/', '_site/', 'Gemfile', 'Gemfile.lock',
  'pages-publication-inventory.json',
  'vendor/*', 'vendor/**/*', 'tests/', 'scripts/', 'api/', 'tmp/', 'tools/', '_ws_tools/'
]) {
  assert(excludeSet.has(required), `_config.yml must fail closed for ${required}`);
}

const signupManifestFixture = path.join(root, 'api', 'agreements', 'signup-manifest');
assert(fs.existsSync(signupManifestFixture), 'synthetic signup-manifest fixture must remain available to local live tests');
const signupFixture = JSON.parse(fs.readFileSync(signupManifestFixture, 'utf8'));
assert.strictEqual(signupFixture.syntheticTestFixture, true, 'local signup-manifest fixture must identify itself as synthetic');
assert.strictEqual(signupFixture.counselApproved, false, 'local signup-manifest fixture must never claim counsel approval');
assert(excludeSet.has('api/'), 'the entire local API fixture tree must remain outside the GitHub Pages publication boundary');

const extensionRelease = JSON.parse(read('extension-version.json'));
assert(/^\d+(?:\.\d+){1,3}$/.test(String(extensionRelease.version || '')), 'published extension feed must contain a valid version');

const vendorTraversalIncludes = ['vendor', ...PUBLIC_VENDOR_ASSETS.map((rel) => path.posix.basename(rel))];
const expectedIncludes = [...PUBLIC_HTML, ...PUBLIC_ASSETS, ...vendorTraversalIncludes, 'CNAME'];
assert.deepStrictEqual(sorted(includes), sorted(expectedIncludes), 'Jekyll include allowlist must exactly match reviewed public HTML/assets and CNAME while the candidate is held');

const diskHtml = fs.readdirSync(root).filter((name) => /\.html$/i.test(name));
assert.deepStrictEqual(
  sorted(diskHtml),
  sorted([...PUBLIC_HTML, ...RETIRED_HTML]),
  'every root HTML file must be explicitly classified; review any new page before publishing'
);
for (const page of PUBLIC_HTML) {
  assert(fs.existsSync(path.join(root, page)), `public page is missing: ${page}`);
  assert(includeSet.has(page), `public page is not allowlisted: ${page}`);
}
for (const asset of PUBLIC_ASSETS) {
  assert(fs.existsSync(path.join(root, asset)), `public runtime asset is missing: ${asset}`);
  assert(includeSet.has(asset), `public runtime asset is not allowlisted: ${asset}`);
  assert(!excludeSet.has(asset), `public runtime asset remains explicitly excluded: ${asset}`);
}

/* GitHub Pages uses Jekyll 3.10, whose EntryFilter checks an exact include
 * before directory exclusions. Materialize that rule into an isolated output
 * tree, then verify that the otherwise-excluded vendor directory publishes
 * only the reviewed runtime bytes and that those bytes still match provenance. */
function verifiedVendorPublication() {
  const provenance = JSON.parse(read('vendor/provenance.json'));
  const provenanceAssets = new Map();
  for (const pkg of provenance.packages || []) {
    const assets = pkg.assets || (pkg.asset ? [{ asset: pkg.asset, sha256: pkg.sha256 }] : []);
    for (const asset of assets) {
      assert(asset && asset.asset && /^[a-f0-9]{64}$/.test(asset.sha256 || ''), `invalid provenance asset for ${pkg.package || 'unknown package'}`);
      provenanceAssets.set(`vendor/${asset.asset}`, asset.sha256);
    }
  }
  assert.deepStrictEqual(sorted(provenanceAssets.keys()), sorted(PUBLIC_VENDOR_ASSETS), 'published vendor allowlist must exactly match pinned provenance assets');

  const publishRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-jekyll-vendor-publication-'));
  try {
    for (const rel of PUBLIC_VENDOR_ASSETS) {
      assert(includeSet.has(path.posix.basename(rel)), `pinned vendor asset basename is not explicitly included: ${rel}`);
      assert(includeSet.has('vendor'), 'vendor traversal must be explicitly opened for Jekyll 3.10');
      assert(excludeSet.has('vendor/*') && excludeSet.has('vendor/**/*'), 'vendor children must stay excluded by default');
      const source = path.join(root, rel);
      const output = path.join(publishRoot, rel);
      assert(fs.existsSync(source), `pinned vendor source is missing: ${rel}`);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(source, output);
    }

    const outputFiles = fs.readdirSync(path.join(publishRoot, 'vendor'), { withFileTypes: true });
    assert(outputFiles.every((entry) => entry.isFile()), 'generated vendor publication must not contain directories, licenses, or source extras');
    assert.deepStrictEqual(
      sorted(outputFiles.map((entry) => `vendor/${entry.name}`)),
      sorted(PUBLIC_VENDOR_ASSETS),
      'generated vendor publication must contain only the exact approved runtime files'
    );
    for (const rel of PUBLIC_VENDOR_ASSETS) {
      const output = path.join(publishRoot, rel);
      const actual = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
      assert.strictEqual(actual, provenanceAssets.get(rel), `generated publication hash differs from provenance: ${rel}`);
    }

    const productionRuntime = [read('ScribeFlow.html'), ...fs.readdirSync(root)
      .filter((name) => /^(?!.*\.staging\.js$).+\.js$/i.test(name))
      .map((name) => read(name))]
      .join('\n');
    const referenced = new Set(Array.from(productionRuntime.matchAll(/["'](?:\.\/|\/)?(vendor\/[A-Za-z0-9._/-]+)(?:\?[^"']*)?["']/g), (match) => match[1]));
    assert(referenced.size > 0, 'production runtime must reference pinned same-origin vendor assets');
    assert.deepStrictEqual(sorted(referenced), sorted(PUBLIC_VENDOR_ASSETS), 'production runtime vendor references must exactly match the generated publication allowlist');
    for (const rel of referenced) assert(fs.existsSync(path.join(publishRoot, rel)), `referenced runtime vendor asset is absent from generated publication: ${rel}`);
  } finally {
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedPublishRoot = path.resolve(publishRoot);
    assert(resolvedPublishRoot.startsWith(tempRoot + path.sep) && path.basename(resolvedPublishRoot).startsWith('mls-jekyll-vendor-publication-'), 'refusing to remove an unexpected publication test path');
    fs.rmSync(resolvedPublishRoot, { recursive: true, force: true });
  }
}

verifiedVendorPublication();
for (const page of RETIRED_HTML) {
  assert(!includeSet.has(page), `retired/internal page must not be allowlisted: ${page}`);
}

const zipFiles = fs.readdirSync(root).filter((name) => /\.zip$/i.test(name));
assert(zipFiles.length > 1, 'fixture must exercise historical archive exclusion');
assert.deepStrictEqual(zipFiles.filter((name) => includeSet.has(name)), [], 'no extension ZIP may be published while the candidate release is held');

const stagingJs = fs.readdirSync(root).filter((name) => /\.staging\.js$/i.test(name));
assert(stagingJs.length >= 5, 'fixture must exercise staging JavaScript exclusion');
assert(stagingJs.every((name) => !includeSet.has(name)), 'staging JavaScript must never be explicitly included');
const stagingNamedJs = fs.readdirSync(root).filter((name) => /staging/i.test(name) && /\.js$/i.test(name));
assert(stagingNamedJs.length >= stagingJs.length + 2, 'fixture must exercise both dotted and underscore-named staging JavaScript');
for (const name of stagingNamedJs) {
  assert(!includeSet.has(name), `staging JavaScript must not be included: ${name}`);
  assert(
    /\.staging\.js$/i.test(name) || /_staging_/i.test(name) || excludeSet.has(name),
    `staging JavaScript lacks a fail-closed exclusion pattern or exact exclusion: ${name}`,
  );
}
for (const oldFragment of ['background_append_v136.js', 'content_append_v136.js', 'bg_worker_block.js']) {
  assert(fs.existsSync(path.join(root, oldFragment)), `expected obsolete extension fragment fixture: ${oldFragment}`);
  assert(!includeSet.has(oldFragment), `obsolete extension fragment must not be included: ${oldFragment}`);
}
for (const retiredAsset of RETIRED_ASSETS) {
  assert(fs.existsSync(path.join(root, retiredAsset)), `expected retired production asset fixture: ${retiredAsset}`);
  assert(excludeSet.has(retiredAsset), `retired production asset must be explicitly excluded: ${retiredAsset}`);
}

/* Production pages must not link users or browsers back into a retired page or
 * staging script. Local asset existence is covered by static-site.test.js. */
const forbiddenLinks = [];
for (const page of PUBLIC_HTML) {
  const html = read(page);
  for (const match of html.matchAll(/\b(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1].trim();
    if (!raw || /^(?:data:|mailto:|tel:|javascript:|#)/i.test(raw)) continue;
    let target = '';
    if (/^(?:https?:)?\/\//i.test(raw)) {
      let absolute;
      try { absolute = new URL(raw, 'https://mlsscribe.com'); } catch (_) { continue; }
      if (absolute.origin !== 'https://mlsscribe.com') continue;
      target = decodeURIComponent(absolute.pathname).replace(/^\/+/, '');
    } else {
      target = raw.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\/+/, '');
    }
    const name = path.posix.basename(target.replace(/\\/g, '/'));
    if (RETIRED_HTML.includes(name) || RETIRED_ASSETS.includes(name) || /\.staging\.js$/i.test(name)) forbiddenLinks.push(`${page} -> ${raw}`);
  }
}

const sendInvite = read('send-portal-invite.html');
const inviteAcceptsPatientQuery = /URLSearchParams\s*\(\s*location\.search\s*\)[\s\S]{0,700}?\.get\(['"](?:email|name|dob|id|pid)['"]\)/i.test(sendInvite);
const phonePage = read('phone.html');
const phoneManifest = JSON.parse(read('phone-manifest.json'));
const productionApp = read('ScribeFlow.html');
assert.strictEqual(phoneManifest.start_url, '/phone.html', 'published phone manifest must launch the reviewed recorder route');
assert(productionApp.includes("const link=location.origin+'/phone.html#code='+encodeURIComponent(phoneMicCode)"), 'published ScribeFlow phone handoff must keep its code in the fragment');
assert(!productionApp.includes('phone.html?code='), 'published ScribeFlow must not generate a query-based pairing link');
assert(phonePage.includes("var c=(hp('code')||hp('mic')||'').trim().toUpperCase()"), 'published phone route must accept only fragment pairing codes');
assert(phonePage.includes('That old pairing link is no longer accepted.'), 'published phone route must fail closed with recovery guidance for legacy queries');

const runtimeRetiredRefs = [];
const connectRuntime = read('mls-connect.js');
for (const asset of RETIRED_ASSETS) {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:var\\s+A\\s*=|\\.src\\s*=)\\s*["']${escaped}["']`).test(connectRuntime)) runtimeRetiredRefs.push(`mls-connect.js loads ${asset}`);
}
if (/['"]\/easy-book\.html['"]/.test(connectRuntime)) runtimeRetiredRefs.push('mls-connect.js generates retired easy-book.html URLs');
if (/['"]\/easy-book\.html['"]/.test(read('feat_mls_patient_reach_v2.js'))) runtimeRetiredRefs.push('feat_mls_patient_reach_v2.js generates retired easy-book.html URLs');
if (/\bMKT_URL\s*=\s*['"]mls-marketing\.html['"]/.test(read('mls_reviews_scrape_app.js'))) runtimeRetiredRefs.push('mls_reviews_scrape_app.js targets retired mls-marketing.html');

/* Candidate source and an unstamped ZIP must never be assembled in a visitor's
 * browser. The page may expose only the separately published store channel. */
const extensionPage = read('get-extension.html');
assert(!/\bJSZip\b|var\s+FILES\s*=|fetch\(\s*['"]\/manifest\.json/i.test(extensionPage), 'download page must not assemble loose extension source');
assert(/id=["']dl["'][^>]*\bdisabled\b/i.test(extensionPage) && /candidate package withheld/i.test(extensionPage), 'manual candidate download must visibly fail closed');

/* Execute the real service worker against deterministic cache/network doubles.
 * This verifies behavior, not just string markers. */
async function verifyServiceWorkerRuntime() {
  const origin = 'https://mlsscribe.com';
  const handlers = Object.create(null);
  const stores = new Map();
  const fetchCalls = [];
  let networkOffline = false;

  const keyOf = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const basicResponse = (body) => {
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, 'type', { value: 'basic' });
    return response;
  };

  class FakeCache {
    constructor() { this.entries = new Map(); }
    async addAll(urls) {
      for (const url of urls) this.entries.set(keyOf(url), new Response(`shell:${url}`, { status: 200 }));
    }
    async match(request) { return this.entries.get(keyOf(request)); }
    async put(request, response) { this.entries.set(keyOf(request), response); }
    async delete(request) { return this.entries.delete(keyOf(request)); }
    async keys() { return Array.from(this.entries.keys(), (url) => new Request(url)); }
  }

  const cacheApi = {
    async keys() { return Array.from(stores.keys()); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name);
    },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const cache of stores.values()) {
        const response = await cache.match(request);
        if (response) return response;
      }
      return undefined;
    }
  };

  const context = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    Set,
    Promise,
    console,
    caches: cacheApi,
    fetch: async (request) => {
      fetchCalls.push(keyOf(request));
      if (networkOffline) throw new Error('synthetic offline');
      return basicResponse(`network:${keyOf(request)}`);
    },
    self: {
      location: { origin },
      addEventListener(type, handler) { handlers[type] = handler; }
    }
  });

  vm.runInContext(read('sw.js'), context, { filename: 'sw.js' });
  assert.deepStrictEqual(Object.keys(handlers).sort(), ['activate', 'fetch', 'install'], 'service worker must register install/activate/fetch handlers');

  const oldCache = await cacheApi.open('mls-v5');
  await oldCache.put(new Request(`${origin}/AuthPilot.html`), new Response('unsafe-old-page'));
  await oldCache.put(new Request(`${origin}/MLS_Assist_v1.42.zip`), new Response('old-zip'));
  await oldCache.put(new Request(`${origin}/appointment.html?token=synthetic-appointment-secret`), new Response('query-key'));
  await oldCache.put(new Request(`${origin}/legal-connect.html?code=synthetic-legal-secret`), new Response('query-key'));
  await oldCache.put(new Request(`${origin}/privacy.html`), new Response('generic-page'));
  await oldCache.put(new Request(`${origin}/feat_safe.js?v=reviewed-1`), new Response('safe-versioned-asset'));
  await oldCache.put(new Request(`${origin}/feat_mls_fixpack_0701.js?v=20260716fp110`), new Response('unsafe-old-find-route'));
  await oldCache.put(new Request(`${origin}/feat_mls_status_center.js?v=20260718sc1e-b415`), new Response('unsafe-old-account-status'));
  await oldCache.put(new Request(`${origin}/${PUBLIC_VENDOR_REQUESTS[0]}`), new Response('approved-vendor-asset'));
  await oldCache.put(new Request(`${origin}/vendor/chart.umd-4.4.1.js?v=retired`), new Response('retired-vendor-asset'));
  await oldCache.put(new Request(`${origin}/ScribeFlow.html`), new Response('safe-shell'));

  let installWork;
  handlers.install({ waitUntil(promise) { installWork = Promise.resolve(promise); } });
  await installWork;
  assert.strictEqual(await oldCache.match(`${origin}/AuthPilot.html`), undefined, 'install must purge a cached retired HTML page before activation');
  assert.strictEqual(await oldCache.match(`${origin}/MLS_Assist_v1.42.zip`), undefined, 'install must purge a cached historical ZIP before activation');
  assert.strictEqual(await oldCache.match(`${origin}/appointment.html?token=synthetic-appointment-secret`), undefined, 'install must purge query-bearing appointment cache keys');
  assert.strictEqual(await oldCache.match(`${origin}/legal-connect.html?code=synthetic-legal-secret`), undefined, 'install must purge query-bearing legal cache keys');
  assert.strictEqual(await oldCache.match(`${origin}/privacy.html`), undefined, 'install must purge pages outside the explicit static cache allowlist');
  assert(await oldCache.match(`${origin}/feat_safe.js?v=reviewed-1`), 'install purge must preserve exact versioned static assets');
  assert(await oldCache.match(`${origin}/feat_mls_fixpack_0701.js?v=20260716fp110`), 'old immutable asset should remain isolated under only its exact retired URL');
  assert(await oldCache.match(`${origin}/feat_mls_status_center.js?v=20260718sc1e-b415`), 'old Status Center asset should remain isolated under only its exact retired URL');
  assert(await oldCache.match(`${origin}/${PUBLIC_VENDOR_REQUESTS[0]}`), 'install purge must preserve an exact approved vendor runtime asset');
  assert.strictEqual(await oldCache.match(`${origin}/vendor/chart.umd-4.4.1.js?v=retired`), undefined, 'install must purge a retired/unapproved vendor runtime asset');
  assert(await oldCache.match(`${origin}/ScribeFlow.html`), 'install purge must preserve the reviewed token-free production app shell');

  async function runFetch(url, options = {}) {
    const headers = new Headers({ accept: options.accept || '*/*' });
    const request = new Request(url, { method: 'GET', headers });
    Object.defineProperty(request, 'mode', { value: options.mode || 'cors' });
    let responsePromise;
    const background = [];
    handlers.fetch({
      request,
      respondWith(value) { responsePromise = Promise.resolve(value); },
      waitUntil(value) { background.push(Promise.resolve(value)); }
    });
    assert(responsePromise, `service worker did not handle same-origin request: ${url}`);
    const response = await responsePromise;
    await Promise.allSettled(background);
    return response;
  }

  let externalIntercepted = false;
  handlers.fetch({
    request: { method: 'GET', url: 'https://scrivara-backend.onrender.com/api/health', mode: 'cors', headers: new Headers() },
    respondWith() { externalIntercepted = true; },
    waitUntil() {}
  });
  assert.strictEqual(externalIntercepted, false, 'service worker must never intercept the API backend or any cross-origin request');

  const callsBeforeRetired = fetchCalls.length;
  const retired = await runFetch(`${origin}/AuthPilot.html?cache-bust=1`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(retired.status, 410, 'retired navigation must fail closed');
  assert.strictEqual(fetchCalls.length, callsBeforeRetired, 'retired navigation must not reach network or cached content');

  const unknown = await runFetch(`${origin}/future-internal-tool.html`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(unknown.status, 410, 'unknown HTML navigation must fail closed');
  const encodedRetired = await runFetch(`${origin}/%41uthPilot.HTML`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(encodedRetired.status, 410, 'case or percent encoding must not bypass the retired HTML boundary');
  const packageNavigation = await runFetch(`${origin}/popup.html`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(packageNavigation.status, 410, 'extension package HTML must not open as a website page');
  const oldScript = await runFetch(`${origin}/mls-connect.staging.js`);
  assert.strictEqual(oldScript.status, 410, 'staging JavaScript must fail closed');
  const oldZip = await runFetch(`${origin}/MLS_Assist_v2.9.41.zip`);
  assert.strictEqual(oldZip.status, 410, 'historical extension archives must fail closed');

  const callsBeforeLegacyPhone = fetchCalls.length;
  const legacyPhone = await runFetch(`${origin}/phone.html?code=synthetic-legacy-secret`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(legacyPhone.status, 410, 'legacy query-based phone pairing must fail closed at the service-worker boundary');
  assert.strictEqual(fetchCalls.length, callsBeforeLegacyPhone, 'legacy phone pairing code must not reach the network from a controlled client');

  const publicPhone = await runFetch(`${origin}/phone.html`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(publicPhone.status, 200, 'reviewed phone recorder navigation must reach the network');
  const publicPhoneManifest = await runFetch(`${origin}/phone-manifest.json`);
  assert.strictEqual(publicPhoneManifest.status, 200, 'reviewed phone manifest must reach the network');
  const publicPhoneUi = await runFetch(`${origin}/feat_mls_force_full_phone.js?v=20260719ffp200`);
  assert.strictEqual(publicPhoneUi.status, 200, 'reviewed production phone UI asset must reach the network');
  for (const vendorRequest of PUBLIC_VENDOR_REQUESTS) {
    const response = await runFetch(`${origin}/${vendorRequest}`);
    assert.strictEqual(response.status, 200, `approved same-origin vendor runtime must reach the network: ${vendorRequest}`);
  }

  const callsBeforePrivateVendor = fetchCalls.length;
  for (const privateVendorPath of [
    '/vendor/provenance.json',
    '/vendor/README.md',
    '/vendor/licenses/jspdf-4.2.1-LICENSE.txt',
    '/vendor/chart.umd-4.4.1.js?v=retired',
    '/vendor/not-reviewed.js?v=synthetic'
  ]) {
    const response = await runFetch(origin + privateVendorPath);
    assert.strictEqual(response.status, 410, `unpublished/unapproved vendor path must fail closed: ${privateVendorPath}`);
  }
  assert.strictEqual(fetchCalls.length, callsBeforePrivateVendor, 'private/unapproved vendor paths must not reach the network');

  const callsBeforeCandidate = fetchCalls.length;
  const packageAsset = await runFetch(`${origin}/popup.html`);
  assert.strictEqual(packageAsset.status, 410, 'candidate extension HTML must fail closed even as an asset request');
  const candidateArchive = await runFetch(`${origin}/MLS_Assist_v2.9.43.zip`);
  assert.strictEqual(candidateArchive.status, 410, 'unstamped candidate ZIP must fail closed');
  assert.strictEqual(fetchCalls.length, callsBeforeCandidate, 'candidate extension bytes must not reach the network');

  /* A genuine basic 200 is cacheable only when its URL is an exact static
   * allowlist member. Query strings that can carry tokens/codes never become
   * Cache Storage keys. */
  await runFetch(`${origin}/appointment.html?token=synthetic-live-secret`, { mode: 'navigate', accept: 'text/html' });
  await runFetch(`${origin}/privacy.html`, { mode: 'navigate', accept: 'text/html' });
  await runFetch(`${origin}/ScribeFlow.html?demo=1`, { mode: 'navigate', accept: 'text/html' });
  await runFetch(`${origin}/feat_runtime.js?v=reviewed-2`);
  const newFindAsset = await runFetch(`${origin}/feat_mls_fixpack_0701.js?v=20260719fp111`);
  assert.strictEqual(await newFindAsset.text(), `network:${origin}/feat_mls_fixpack_0701.js?v=20260719fp111`,
    'old fp110 cache entry shadowed the exact-ID/account-bound fp111 Find implementation');
  assert(fetchCalls.includes(`${origin}/feat_mls_fixpack_0701.js?v=20260719fp111`),
    'new Find immutable URL did not reach the network when only fp110 was cached');
  const newStatusCenter = await runFetch(`${origin}/feat_mls_status_center.js?v=20260719sc111`);
  assert.strictEqual(await newStatusCenter.text(), `network:${origin}/feat_mls_status_center.js?v=20260719sc111`,
    'old cached Status Center shadowed the account/epoch-isolated implementation');
  assert(fetchCalls.includes(`${origin}/feat_mls_status_center.js?v=20260719sc111`),
    'new Status Center immutable URL did not reach the network when the old version was cached');
  await runFetch(`${origin}/feat_runtime.js?v=reviewed-2&token=synthetic-secret`);

  const allCacheKeys = () => Array.from(stores.values()).flatMap((cache) => Array.from(cache.entries.keys()));
  const cachedKeys = allCacheKeys();
  assert(!cachedKeys.some((key) => /synthetic-(?:live-)?secret/.test(key)), 'query-bearing workflow/static URLs must never become cache keys');
  const unsafeQueryKeys = cachedKeys.filter((key) => {
    const url = new URL(key);
    if (!url.search) return false;
    const keys = Array.from(url.searchParams.keys());
      return keys.length !== 1 || keys[0] !== 'v' || !/\.(?:m?js|css|woff2?)$/i.test(url.pathname);
  });
  assert.deepStrictEqual(unsafeQueryKeys, [], 'Cache Storage may contain only exact single-parameter versioned static URLs');
  assert(!cachedKeys.includes(`${origin}/privacy.html`), 'generic public pages must not be cached');
  assert(!cachedKeys.includes(`${origin}/phone.html`), 'phone recorder HTML must remain network-only');
  assert(!cachedKeys.includes(`${origin}/phone-manifest.json`), 'phone manifest must remain network-only');
  assert(cachedKeys.includes(`${origin}/feat_mls_force_full_phone.js?v=20260719ffp200`), 'exact reviewed phone UI asset should be cacheable by version');
  assert(!cachedKeys.some((key) => /MLS_Assist_v[^/]+\.zip/i.test(key)), 'extension downloads must not be cached by the service worker');
  assert(cachedKeys.includes(`${origin}/feat_runtime.js?v=reviewed-2`), 'exact versioned static assets must remain cacheable');
  assert(cachedKeys.includes(`${origin}/feat_mls_fixpack_0701.js?v=20260719fp111`), 'new exact-ID Find implementation was not cached under its own immutable URL');
  assert(cachedKeys.includes(`${origin}/feat_mls_status_center.js?v=20260719sc111`), 'preview-safe account-isolated Status Center was not cached under its own immutable URL');
  for (const vendorRequest of PUBLIC_VENDOR_REQUESTS) {
    assert(cachedKeys.includes(`${origin}/${vendorRequest}`), `approved versioned vendor runtime was not cached: ${vendorRequest}`);
  }
  assert(!cachedKeys.includes(`${origin}/feat_runtime.js?v=reviewed-2&token=synthetic-secret`), 'versioned assets with an extra query parameter must not be cached');

  let activateWork;
  handlers.activate({ waitUntil(promise) { activateWork = Promise.resolve(promise); } });
  await activateWork;
  assert.deepStrictEqual(await cacheApi.keys(), ['mls-v43'], 'activation must remove every superseded MLS cache');

  networkOffline = true;
  for (const sensitiveUrl of [
    '/appointment.html?token=synthetic-a',
    '/booking.html?code=synthetic-b',
    '/intake.html?invite=synthetic-c',
    '/patient-portal.html?token=synthetic-f',
    '/phone.html',
    '/review-finder.html',
    '/ScribeFlow.html?demo=1'
  ]) {
    const response = await runFetch(origin + sensitiveUrl, { mode: 'navigate', accept: 'text/html' });
    assert.strictEqual(response.status, 0, `sensitive/query workflow must fail closed offline: ${sensitiveUrl}`);
  }
  for (const retiredUrl of [
    '/easy-book.html',
    '/legal-connect.html?code=synthetic-d',
    '/mls-best-doctors.html',
    '/mls-best-doctors-admin.html',
    '/mls-doctor-awards.html',
    '/mls-marketing.html',
    '/mls-marketing-console.html',
    '/mls-widgets.html',
    '/patient-review.html?token=synthetic-g',
    '/send-portal-invite.html',
    '/feat_mls_best_doctors.js',
    '/feat_mls_review_request.js',
    '/legal-connect-ui.js'
  ]) {
    const response = await runFetch(origin + retiredUrl, { mode: 'navigate', accept: 'text/html' });
    assert.strictEqual(response.status, 410, `retired workflow must stay unavailable offline: ${retiredUrl}`);
  }
  const offlineGenericPage = await runFetch(`${origin}/privacy.html`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(offlineGenericPage.status, 0, 'generic offline navigation must not be replaced with the clinical app');
  const offlineApp = await runFetch(`${origin}/ScribeFlow.html`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(await offlineApp.text(), 'shell:/ScribeFlow.html', 'exact token-free app navigation may use the reviewed static shell offline');
  const offlineHome = await runFetch(`${origin}/`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(await offlineHome.text(), 'shell:/index.html', 'exact home navigation may use the reviewed static shell offline');
  const offlineAsset = await runFetch(`${origin}/missing.js`);
  assert.strictEqual(offlineAsset.status, 0, 'offline asset failures must not be replaced with HTML');
  for (const vendorRequest of PUBLIC_VENDOR_REQUESTS) {
    const response = await runFetch(`${origin}/${vendorRequest}`);
    assert.strictEqual(response.status, 200, `approved cached vendor runtime must remain available offline: ${vendorRequest}`);
  }
}

verifyServiceWorkerRuntime().then(() => {
  const sourceViolations = [];
  if (inviteAcceptsPatientQuery) sourceViolations.push('send-portal-invite.html accepts patient identity/demographics from the query string');
  sourceViolations.push(...forbiddenLinks.map((entry) => `public link: ${entry}`));
  sourceViolations.push(...runtimeRetiredRefs.map((entry) => `runtime reference: ${entry}`));
  assert.deepStrictEqual(sourceViolations, [], `publication source still reaches retired/unsafe paths:\n${sourceViolations.join('\n')}`);
  console.log(`PASS public publication boundary: ${PUBLIC_HTML.length} public pages, ${RETIRED_HTML.length} retired pages, candidate source excluded, 0 ZIPs`);
}).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
