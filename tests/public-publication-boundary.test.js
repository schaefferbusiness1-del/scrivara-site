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
  /* The phone app (2026-07-31). The same file is bundled into the iOS and
     Android binaries by mobile/ — see mobile/store/RUNBOOK.md. */
  'app.html',
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
  'phone-setup.html',
  'phone.html',
  'privacy.html',
  'review-finder.html',
  'ScribeFlow.html',
  'terms.html'
];

const PUBLIC_ASSETS = [
  /* app.html's complete published surface. It loads no script, no stylesheet
     and no font, so this is its install manifest and the two store-size icons
     that manifest names — nothing else. */
  'app-icon-1024.png',
  'app-icon-maskable-1024.png',
  'app-manifest.json',
  'feat_mls_force_full_phone.js',
  'phone-manifest.json',
  'public-preview-policy.js',
  'public-preview-runtime.js'
];

/* The owner-only 1p lane is intentionally published, but it is not a
   production navigation target or production runtime. Keep this classification
   separate so adding the preview cannot silently widen PUBLIC_HTML/ASSETS (and
   therefore the production service-worker allowlist) on its behalf. */
const P1_PREVIEW_HTML = [
  '1pScribeFlow.html'
];

const P1_LIVE_HTML = [
  '1p/index.html',
  '1p/legal/index.html',
  '1p/marketing/index.html'
];

/* The /cloned live route: the RELEASE CANDIDATE lane. Until 2026-08-17 it was a
   byte-faithful clone of production; it is now DERIVED from /1p by
   scripts/derive-cloned-from-1p.js, so it carries every /1p feature on
   production's route identity. That means it publishes the same shape /1p does:
   one shell, one bundle, and one cloned-feat_*.js per 1p-feat_*.js fork. Kept
   in its own classification for the same reason as P1_LIVE_HTML above — adding
   it must never silently widen PUBLIC_HTML/ASSETS or the production
   service-worker allowlist. */
const CLONED_LIVE_HTML = [
  'cloned/index.html'
];

/* The /wyzant product page (2026-08-19). A marketing page for Wyzant Local, a
   SEPARATE desktop product that shares no code with the clinical app: it loads
   no app script, registers no service worker, and links to nothing in the
   production runtime. Classified on its own for the same reason as the two
   lists above — it must never widen PUBLIC_HTML/ASSETS, and therefore never
   widen the production service-worker allowlist, on its own behalf. */
const WYZANT_HTML = [
  'wyzant/index.html'
];

/* Derived 1:1 from P1_PREVIEW_ASSETS below. Jekyll publishes .js by default
   (only HTML/ZIP/BIN/staging-JS and named modules are excluded), so — exactly
   like the 1p forks — these need an inventory entry and no include line. */
const CLONED_ASSETS = [
  'cloned-mls-connect.js',
  'cloned-feat_mls_athena_occurrence.js',
  'cloned-feat_athena_provider_roster.js',
  'cloned-feat_mls_avatar.js',
  'cloned-feat_mls_avatar_face.js',
  'cloned-feat_mls_b121_pack.js',
  'cloned-feat_mls_draft_tuning.js',
  'cloned-feat_mls_first_pull_style.js',
  'cloned-feat_fullhistory_pdf.js',
  'cloned-feat_mls_legalpack.js',
  'cloned-feat_mls_marketing.js',
  'cloned-feat_nextup_connect.js',
  'cloned-feat_mls_schedimport_exact.js',
  'cloned-feat_mls_mobile_encounter.js',
  'cloned-feat_mls_rangejobs.js',
  'cloned-feat_mls_study_provenance.js',
  'cloned-feat_mls_template_modes.js',
  'cloned-feat_mls_writeflow.js',
  'cloned-feat_task3_frontsync.js'
];

const P1_PREVIEW_ASSETS = [
  '1p-mls-connect.js',
  '1p-feat_mls_athena_occurrence.js',
  '1p-feat_athena_provider_roster.js',
  '1p-feat_mls_avatar.js',
  '1p-feat_mls_avatar_face.js',
  '1p-feat_mls_b121_pack.js',
  '1p-feat_mls_draft_tuning.js',
  '1p-feat_mls_first_pull_style.js',
  '1p-feat_fullhistory_pdf.js',
  '1p-feat_mls_legalpack.js',
  '1p-feat_mls_marketing.js',
  '1p-feat_nextup_connect.js',
  '1p-feat_mls_schedimport_exact.js',
  '1p-feat_mls_mobile_encounter.js',
  '1p-feat_mls_rangejobs.js',
  '1p-feat_mls_study_provenance.js',
  '1p-feat_mls_template_modes.js',
  '1p-feat_mls_writeflow.js',
  '1p-feat_task3_frontsync.js'
];

/* The clone is derived from /1p file-for-file, so its published asset list must
   be the 1p list renamed — nothing added, nothing dropped. Asserting the
   correspondence here means a NEW 1p fork cannot be published without its
   clone counterpart being registered too. */
assert.deepStrictEqual(
  sorted(CLONED_ASSETS),
  sorted(P1_PREVIEW_ASSETS.map((n) => n === '1p-mls-connect.js' ? 'cloned-mls-connect.js' : 'cloned-feat_' + n.slice('1p-feat_'.length))),
  'the /cloned published asset list must be exactly the /1p list renamed — the clone is derived from /1p file-for-file'
);

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
  /* feat_mls_legalpack.js left this list 2026-08-20: the production promotion
     put the 1p fork's DRAFT-ONLY legal workspace (fail-closed, no payment, no
     delivery; legal-luna model choice) under the shared name. The pay-era
     machinery above stays retired. */
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
  'vendor/*', 'vendor/**/*', 'tests/', 'scripts/', 'docs/', 'api/', 'tmp/', 'tools/', '_ws_tools/'
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
const p1TraversalIncludes = ['1p/legal/index.html', '1p/marketing/index.html'];
const clonedTraversalIncludes = ['cloned/index.html'];
const wyzantTraversalIncludes = [...WYZANT_HTML];
/* Owner directive 2026-08-25: the exact stamped 3.0.81 release ships publicly;
 * its bytes are digest-pinned below. Candidates stay excluded. */
const RELEASED_PACKAGE = 'MLS_Assist_v3.0.81.zip';
const RELEASED_PACKAGE_SHA256 = '716b4e63002c89cd7372be73f5eafe7bc47f280e0af34ae3e55e316f51c30f5c';
assert(/^[a-f0-9]{64}$/.test(RELEASED_PACKAGE_SHA256),
  '3.0.81 package digest must be stamped after deterministic packaging before publication');
/* 2026-08-06, pin moved deliberately: a byte-identical mirror of the released
   package under an extension no service-worker generation retires. An installed
   worker keeps controlling a tab until every tab closes, and this app's worker
   deliberately declines skipWaiting(), so a stale worker answers the .zip with
   410 regardless of what we ship — measured live, the worker did not roll
   across three production deploys. Its bytes are digest-asserted EQUAL to the
   zip below, so this widens the published surface by zero new content. */
const RELEASED_PACKAGE_MIRROR = 'MLS_Assist_v3.0.81.bin';
const expectedIncludes = [...PUBLIC_HTML, ...P1_PREVIEW_HTML, ...PUBLIC_ASSETS, ...vendorTraversalIncludes, ...p1TraversalIncludes, ...clonedTraversalIncludes, ...wyzantTraversalIncludes, RELEASED_PACKAGE, RELEASED_PACKAGE_MIRROR, 'CNAME'];
assert.deepStrictEqual(sorted(includes), sorted(expectedIncludes), 'Jekyll include allowlist must exactly match reviewed public HTML/assets, the digest-pinned released package, and CNAME');

const diskHtml = fs.readdirSync(root).filter((name) => /\.html$/i.test(name));
assert.deepStrictEqual(
  sorted(diskHtml),
  sorted([...PUBLIC_HTML, ...P1_PREVIEW_HTML, ...RETIRED_HTML]),
  'every root HTML file must be explicitly classified; review any new page before publishing'
);

/* EXTENSION-LESS ROOT FILES — the hole a zero-byte `x` fell through (2026-08-08).
   Every classification above keys on an EXTENSION (.html, .zip, .staging.js), so a
   root file with no dot in its name matched nothing here, and Jekyll publishes it by
   default. `git add -A` swept up a stray shell redirect named `x`; the local gate went
   512/512 green, and the CI Pages audit correctly refused the deploy with
   "unexpected/unreviewed generated file: x" — which meant b954 was pushed and NEVER
   SERVED, with the site left on b953 and nothing locally able to say why.
   Deliberately NOT a Jekyll emulation: a stub looser than the real EntryFilter would
   hide the very call it is meant to catch. The decidable claim is enough — a root file
   with no extension is a publication decision, so it must be named here on purpose. */
const EXTENSIONLESS_ROOT = [
  'CNAME',      /* published: the custom domain, and it IS in the inventory */
  'Gemfile',    /* build input, never published */
  'LICENSE'     /* not published; excluded in _config.yml */
];
/* the SAME inventory the CI audit loads (scripts/audit-pages-build.js), read here so
   the local gate and the publish gate cannot disagree about what is public */
const publicationInventory = JSON.parse(read('pages-publication-inventory.json'));
assert(publicationInventory && publicationInventory.schemaVersion === 1 && Array.isArray(publicationInventory.paths),
  'pages-publication-inventory.json changed shape — the CI Pages audit reads this file and would fail differently');
const inventorySet = new Set(publicationInventory.paths);
const diskExtensionless = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.includes('.'))
  .map((entry) => entry.name);
assert.deepStrictEqual(
  sorted(diskExtensionless),
  sorted(EXTENSIONLESS_ROOT),
  'a root file with no extension appeared: Jekyll publishes it by default, so either add it to ' +
  'pages-publication-inventory.json AND the include allowlist, or delete it — an unreviewed one ' +
  'makes the CI publication audit refuse the deploy and the site silently keeps serving the old build'
);
/* ⛔ AND THE SAME HOLE AGAIN, ONE DOT WIDER (2026-08-09).
   The guard above tests `!name.includes('.')`. b986 shipped a 0-byte root file named
   `M*M*0.72` — the asterisks arriving as private-use glyphs — created when bash read the
   backticks in a `node -e` payload as command substitution and wrote a file named after the
   fragment. It HAS a dot, so it was extension-ful by that test's reckoning, it matched none of
   the extension classifications either, `git add -A` committed it, this suite went green, and
   GitHub Pages refused the build: b986 was pushed and the site kept serving b985 for 8+
   minutes with nothing locally able to say why. Removing the file made b986 appear in ~90s.
   TWO decidable guards, because the last fix was one dot too narrow:
     1. THE NAME. A file a shell wrote by accident does not look like a file a person named.
        Anything outside [A-Za-z0-9_.@~-] is a shell accident or a paste artifact — measured:
        all 535 root files today are inside it, so this costs nothing and would have caught
        the glyphs directly.
     2. THE EXTENSION. A root file whose extension nobody has reviewed is a publication
        decision by default, exactly like an extension-less one. `.72` was on no list.
   Both fail loudly and name the file, so the next one is a 5-second fix instead of a
   10-minute mystery about why the site did not move. */
const ROOT_NAME_SAFE = /^[A-Za-z0-9_.@~-]+$/;
const ROOT_EXT_REVIEWED = [
  'bin', 'css', 'html', 'jpg', 'js', 'json', 'lock', 'md', 'mp4', 'pdf',
  'png', 'txt', 'webmanifest', 'xml', 'yml', 'zip'
];
{
  const rootFiles = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => entry.name);
  const oddNames = rootFiles.filter((name) => !ROOT_NAME_SAFE.test(name));
  assert.deepStrictEqual(oddNames, [],
    'a root file has a name no person would type: ' + JSON.stringify(oddNames) + '. That is a shell ' +
    'accident (backticks or an unquoted glob in a node -e payload write a file named after the ' +
    'fragment), git add -A commits it, and GitHub Pages then REFUSES the build while the site keeps ' +
    'serving the previous one. Delete it.');
  /* a LEADING dot is part of the name, not an extension — `.gitignore` is a whole name, and
     in a worktree `.git` is a FILE. Taking the last dot blindly reported "gitignore" as an
     unreviewed extension, which is the guard being wrong rather than the tree. Only a dot
     with something before it separates a name from an extension. */
  const extOf = (name) => {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  };
  const oddExts = rootFiles
    .map(extOf)
    .filter((ext) => ext && ROOT_EXT_REVIEWED.indexOf(ext) < 0);
  assert.deepStrictEqual(sorted(Array.from(new Set(oddExts))), [],
    'a root file has an unreviewed extension: ' + JSON.stringify(Array.from(new Set(oddExts))) + '. ' +
    'Every classification in this suite keys on the extension, so an unknown one is checked by ' +
    'nothing and Jekyll decides for us. Add it to ROOT_EXT_REVIEWED on purpose, or delete the file.');
}
assert(inventorySet.has('CNAME'), 'CNAME must stay in the publication inventory');
for (const name of EXTENSIONLESS_ROOT) {
  if (name === 'CNAME') continue;
  assert(!inventorySet.has(name), `${name} is not a public file and must stay out of the publication inventory`);
}
for (const page of PUBLIC_HTML) {
  assert(fs.existsSync(path.join(root, page)), `public page is missing: ${page}`);
  assert(includeSet.has(page), `public page is not allowlisted: ${page}`);
}
for (const asset of PUBLIC_ASSETS) {
  assert(fs.existsSync(path.join(root, asset)), `public runtime asset is missing: ${asset}`);
  assert(includeSet.has(asset), `public runtime asset is not allowlisted: ${asset}`);
  assert(!excludeSet.has(asset), `public runtime asset remains explicitly excluded: ${asset}`);
}
for (const page of P1_PREVIEW_HTML) {
  assert(!PUBLIC_HTML.includes(page), `1p preview page leaked into the production navigation allowlist: ${page}`);
  assert(fs.existsSync(path.join(root, page)), `1p preview page is missing: ${page}`);
  assert(includeSet.has(page), `1p preview page is not explicitly allowlisted for publication: ${page}`);
  assert(inventorySet.has(page), `1p preview page is absent from the generated-site publication inventory: ${page}`);
}
for (const page of P1_LIVE_HTML) {
  assert(!PUBLIC_HTML.includes(page), `1p live page leaked into the production navigation allowlist: ${page}`);
  assert(fs.existsSync(path.join(root, page)), `1p live page is missing: ${page}`);
  assert(includeSet.has(path.posix.basename(page)), `1p live page basename is not explicitly allowlisted for publication: ${page}`);
  if (page === '1p/legal/index.html') assert(includeSet.has(page), 'FREE Legal showcase lacks its exact nested publication include');
  if (page === '1p/marketing/index.html') assert(includeSet.has(page), 'FREE Marketing showcase lacks its exact nested publication include');
  assert(inventorySet.has(page), `1p live page is absent from the generated-site publication inventory: ${page}`);
}
for (const asset of P1_PREVIEW_ASSETS) {
  assert(!PUBLIC_ASSETS.includes(asset), `1p preview asset leaked into the production runtime allowlist: ${asset}`);
  assert(fs.existsSync(path.join(root, asset)), `1p preview runtime asset is missing: ${asset}`);
  assert(inventorySet.has(asset), `1p preview runtime asset is absent from the generated-site publication inventory: ${asset}`);
  assert(!excludeSet.has(asset), `1p preview runtime asset remains explicitly excluded: ${asset}`);
}
for (const page of CLONED_LIVE_HTML) {
  assert(!PUBLIC_HTML.includes(page), `cloned live page leaked into the production navigation allowlist: ${page}`);
  assert(fs.existsSync(path.join(root, page)), `cloned live page is missing: ${page}`);
  assert(includeSet.has(path.posix.basename(page)), `cloned live page basename is not explicitly allowlisted for publication: ${page}`);
  assert(includeSet.has(page), `cloned live page lacks its exact nested publication include: ${page}`);
  assert(inventorySet.has(page), `cloned live page is absent from the generated-site publication inventory: ${page}`);
}
for (const page of WYZANT_HTML) {
  assert(!PUBLIC_HTML.includes(page), `wyzant product page leaked into the production navigation allowlist: ${page}`);
  assert(fs.existsSync(path.join(root, page)), `wyzant product page is missing: ${page}`);
  assert(includeSet.has(path.posix.basename(page)), `wyzant product page basename is not explicitly allowlisted for publication: ${page}`);
  assert(includeSet.has(page), `wyzant product page lacks its exact nested publication include: ${page}`);
  assert(inventorySet.has(page), `wyzant product page is absent from the generated-site publication inventory: ${page}`);
  /* It is a separate product, so it must not reach into the clinical runtime.
     A stray <script src="mls-connect.js"> here would put app code on a page
     that never registers a service worker to manage it. */
  const html = read(page);
  assert(!/<script[^>]+src=/i.test(html), `wyzant product page must load no external script: ${page}`);
  assert(!/serviceWorker/i.test(html), `wyzant product page must not register a service worker: ${page}`);
}
for (const asset of CLONED_ASSETS) {
  assert(!PUBLIC_ASSETS.includes(asset), `cloned runtime asset leaked into the production runtime allowlist: ${asset}`);
  assert(fs.existsSync(path.join(root, asset)), `cloned runtime asset is missing: ${asset}`);
  assert(inventorySet.has(asset), `cloned runtime asset is absent from the generated-site publication inventory: ${asset}`);
  assert(!excludeSet.has(asset), `cloned runtime asset remains explicitly excluded: ${asset}`);
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
/* Owner directive 2026-08-25: EXACTLY the stamped 3.0.81 release is public.
 * Its published bytes must equal the release digest — any drift fails. */
assert.deepStrictEqual(zipFiles.filter((name) => includeSet.has(name)), ['MLS_Assist_v3.0.81.zip'],
  'exactly the released 3.0.81 package may be published — nothing else, and never a candidate');
const releasedZipSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'MLS_Assist_v3.0.81.zip'))).digest('hex');
assert.strictEqual(releasedZipSha, RELEASED_PACKAGE_SHA256,
  'published package bytes must be the exact stamped 3.0.81 release');
/* The mirror is the SAME BYTES or it is a second, unreviewed artifact. This is
   the assertion that keeps "a route stale workers can reach" from becoming "a
   second package nobody digest-checked". */
const mirrorSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'MLS_Assist_v3.0.81.bin'))).digest('hex');
assert.strictEqual(mirrorSha, releasedZipSha,
  'the .bin mirror must be byte-identical to the released package — never a separate build');

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
assert(/id=["']dl["'][^>]*href=["']MLS_Assist_v3.0.81\.zip["']/i.test(extensionPage) &&
  new RegExp(RELEASED_PACKAGE_SHA256, 'i').test(extensionPage) &&
  !/candidate package withheld/i.test(extensionPage),
  'manual download must offer exactly the released package with its displayed digest');

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
  /* Deliberate current boundary: 1p is published at the origin but remains
     outside the production worker's navigation allowlist. A controlled browser
     receives the same fail-closed response as any other non-production HTML. */
  const callsBeforeP1Preview = fetchCalls.length;
  const p1Preview = await runFetch(`${origin}/1pScribeFlow.html`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(p1Preview.status, 410, '1p preview must not widen the production service-worker HTML allowlist');
  assert.strictEqual(fetchCalls.length, callsBeforeP1Preview, 'blocked 1p preview navigation must not reach the network');
  const callsBeforeP1Live = fetchCalls.length;
  const p1Live = await runFetch(`${origin}/1p/`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(p1Live.status, 200, 'the dedicated extensionless /1p/ route must open through an already-active service worker');
  assert.strictEqual(fetchCalls.length, callsBeforeP1Live + 1, 'the /1p/ live preview navigation must reach the network');
  /* Same extensionless-directory shape as /1p/ above: sw.js classifies purely
     on the URL shape (no ".html" basename), so a brand-new lane needs no
     service-worker edit to open — it is a fact about sw.js worth proving. */
  const callsBeforeClonedLive = fetchCalls.length;
  const clonedLive = await runFetch(`${origin}/cloned/`, { mode: 'navigate', accept: 'text/html' });
  assert.strictEqual(clonedLive.status, 200, 'the dedicated extensionless /cloned/ route must open through an already-active service worker');
  assert.strictEqual(fetchCalls.length, callsBeforeClonedLive + 1, 'the /cloned/ live route navigation must reach the network');
  for (const legalPath of ['/1p/legal/', '/1p/legal/index.html']) {
    const callsBeforeLegal = fetchCalls.length;
    const legalShowcase = await runFetch(origin + legalPath, { mode: 'navigate', accept: 'text/html' });
    assert.strictEqual(legalShowcase.status, 200, `the FREE Legal showcase must open through an active worker: ${legalPath}`);
    assert.strictEqual(fetchCalls.length, callsBeforeLegal + 1, `the FREE Legal showcase must reach the network: ${legalPath}`);
  }
  for (const marketingPath of ['/1p/marketing/', '/1p/marketing/index.html']) {
    const callsBeforeMarketing = fetchCalls.length;
    const marketingShowcase = await runFetch(origin + marketingPath, { mode: 'navigate', accept: 'text/html' });
    assert.strictEqual(marketingShowcase.status, 200, `the FREE Marketing showcase must open through an active worker: ${marketingPath}`);
    assert.strictEqual(fetchCalls.length, callsBeforeMarketing + 1, `the FREE Marketing showcase must reach the network: ${marketingPath}`);
  }
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
  /* The exact released 3.0.22 package passes through to the network (never 410,
   * never cached — the cached-keys assertion below covers every ZIP). */
  const releasedArchive = await runFetch(`${origin}/MLS_Assist_v3.0.81.zip`);
  assert.notStrictEqual(releasedArchive.status, 410, 'the exact released package must pass through the service worker');
  assert(fetchCalls.includes(`${origin}/MLS_Assist_v3.0.81.zip`), 'the released package download must reach the network');

  /* A genuine basic 200 is cacheable only when its URL is an exact static
   * allowlist member. Query strings that can carry tokens/codes never become
   * Cache Storage keys. */
  await runFetch(`${origin}/appointment.html?token=synthetic-live-secret`, { mode: 'navigate', accept: 'text/html' });
  await runFetch(`${origin}/privacy.html`, { mode: 'navigate', accept: 'text/html' });
  await runFetch(`${origin}/ScribeFlow.html?demo=1`, { mode: 'navigate', accept: 'text/html' });
  await runFetch(`${origin}/feat_runtime.js?v=reviewed-2`);
  const newFindAsset = await runFetch(`${origin}/feat_mls_fixpack_0701.js?v=20260804fp117`);
  assert.strictEqual(await newFindAsset.text(), `network:${origin}/feat_mls_fixpack_0701.js?v=20260804fp117`,
    'old fp110 cache entry shadowed the exact-ID/account-bound fp111 Find implementation');
  assert(fetchCalls.includes(`${origin}/feat_mls_fixpack_0701.js?v=20260804fp117`),
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
  assert(!cachedKeys.includes(`${origin}/1pScribeFlow.html`), 'the owner-only 1p preview HTML must remain network-only');
  assert(!cachedKeys.includes(`${origin}/1p/`), 'the /1p/ live preview HTML must remain network-only');
  assert(!cachedKeys.includes(`${origin}/cloned/`), 'the /cloned/ live route HTML must remain network-only');
  assert(!cachedKeys.includes(`${origin}/1p/legal/`), 'the /1p/legal/ showcase must remain network-only');
  assert(!cachedKeys.includes(`${origin}/1p/legal/index.html`), 'the /1p/legal/index.html showcase must remain network-only');
  assert(!cachedKeys.includes(`${origin}/1p/marketing/`), 'the /1p/marketing/ showcase must remain network-only');
  assert(!cachedKeys.includes(`${origin}/1p/marketing/index.html`), 'the /1p/marketing/index.html showcase must remain network-only');
  assert(!cachedKeys.includes(`${origin}/phone.html`), 'phone recorder HTML must remain network-only');
  assert(!cachedKeys.includes(`${origin}/phone-manifest.json`), 'phone manifest must remain network-only');
  assert(cachedKeys.includes(`${origin}/feat_mls_force_full_phone.js?v=20260719ffp200`), 'exact reviewed phone UI asset should be cacheable by version');
  assert(!cachedKeys.some((key) => /MLS_Assist_v[^/]+\.zip/i.test(key)), 'extension downloads must not be cached by the service worker');
  assert(cachedKeys.includes(`${origin}/feat_runtime.js?v=reviewed-2`), 'exact versioned static assets must remain cacheable');
  assert(cachedKeys.includes(`${origin}/feat_mls_fixpack_0701.js?v=20260804fp117`), 'new exact-ID Find implementation was not cached under its own immutable URL');
  assert(cachedKeys.includes(`${origin}/feat_mls_status_center.js?v=20260719sc111`), 'preview-safe account-isolated Status Center was not cached under its own immutable URL');
  for (const vendorRequest of PUBLIC_VENDOR_REQUESTS) {
    assert(cachedKeys.includes(`${origin}/${vendorRequest}`), `approved versioned vendor runtime was not cached: ${vendorRequest}`);
  }
  assert(!cachedKeys.includes(`${origin}/feat_runtime.js?v=reviewed-2&token=synthetic-secret`), 'versioned assets with an extra query parameter must not be cached');

  let activateWork;
  handlers.activate({ waitUntil(promise) { activateWork = Promise.resolve(promise); } });
  await activateWork;
  assert.deepStrictEqual(await cacheApi.keys(), ['mls-v206'], 'activation must remove every superseded MLS cache');

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

  /* ph-offline-1.0.0 (2026-07-25, phone lane): the ONE query that may resolve.
   * ?phone=1 is the exact URL the pairing QR and the setup email hand to a
   * phone (mls-connect.js PHONE_URL). Every query used to fail closed here, so
   * that address was a browser error page offline while the byte-identical
   * /ScribeFlow.html sat in the cache — the one URL we tell phones to use was
   * the one URL that could not open. It is secret-free (contrast ?token=,
   * ?code=, ?invite=, and ?demo=1, all asserted closed above) and behaviourally
   * identical, since phone mode persists in sessionStorage. */
  for (const modeUrl of ['/ScribeFlow.html?phone=1', '/ScribeFlow.html?phone=0']) {
    const modeResponse = await runFetch(origin + modeUrl, { mode: 'navigate', accept: 'text/html' });
    assert.strictEqual(modeResponse.status, 200,
      `secret-free phone mode flag must resolve to the cached shell offline: ${modeUrl}`);
  }
  /* …and the allowance must be READ-ONLY: the query URL is never cached. */
  /* Derive the cache name rather than hardcoding it — activation above already
     asserts there is exactly one, and a hardcoded stamp silently desyncs on the
     next CACHE bump (it survived one only by luck of a textual rebase). */
  const [liveCacheName] = await cacheApi.keys();
  const afterModeKeys = (await (await cacheApi.open(liveCacheName)).keys()).map((r) => r.url);
  assert(!afterModeKeys.some((u) => /ScribeFlow\.html\?phone=/.test(u)),
    'the phone mode flag must never be written to the cache — only read back from the plain shell');
  /* A near-miss must NOT be waved through: the whitelist is exact strings. */
  for (const nearMiss of ['/ScribeFlow.html?phone=1&token=synthetic-h', '/ScribeFlow.html?phone=2']) {
    const missResponse = await runFetch(origin + nearMiss, { mode: 'navigate', accept: 'text/html' });
    assert.strictEqual(missResponse.status, 0,
      `only the exact secret-free mode flags may resolve offline: ${nearMiss}`);
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
  console.log(`PASS public publication boundary: ${PUBLIC_HTML.length} production pages, ${P1_PREVIEW_HTML.length} legacy 1p source page, ${P1_LIVE_HTML.length} dedicated /1p/ live page, ${RETIRED_HTML.length} retired pages, candidate source excluded, exactly the digest-pinned released ZIP`);
}).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
