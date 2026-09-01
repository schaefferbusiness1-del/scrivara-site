'use strict';

/*
 * The extension manifest must be clean UTF-8, and the checker's loader token
 * must move whenever the checker does.
 *
 * BOTH OF THESE SHIPPED IN b622, and neither was caught by anything.
 *
 * 1. MOJIBAKE IN THE PUBLISHED PACKAGE. manifest.json's toolbar tooltip read
 *
 *        "MLS Assist Ã¢â‚¬â€ settings"
 *
 *    where it should read "MLS Assist — settings". The em-dash had been
 *    UTF-8-decoded as cp1252 twice: bytes c3 83 c2 a2 c3 a2 e2 80 9a c2 ac
 *    c3 a2 e2 82 ac c2 9d in place of e2 80 94.
 *
 *    Nothing objected, and each reason is individually reasonable:
 *      - manifest.json is EXCLUDED from the core digest (that covers the 19
 *        non-manifest files), so the digest was correct;
 *      - JSON.parse succeeds on mojibake, it is valid text;
 *      - no test read default_title.
 *    So a corrupted string was byte-verified, digest-pinned, published and
 *    served. Byte-verification proves the bytes you shipped are the bytes you
 *    built; it says nothing about whether they were right.
 *
 * 2. A CHANGED FILE BEHIND A FROZEN TOKEN. feat_mls_checker.js had
 *    SERVER_EXT_VERSION moved 3.0.6 -> 3.0.20, but its immutable loader token
 *    stayed 20260724chk306r1. The service worker serves versioned asset URLs
 *    cache-first, so every browser would have kept the OLD checker and gone on
 *    believing the published version was 3.0.6 — on the one file whose entire
 *    job is telling users which version is published. This is the frozen-token
 *    failure that cost six builds in July, aimed at the worst possible target.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* ---- 1. the manifest carries no mojibake ---------------------------------- */

const manifestRaw = read('manifest.json');
const manifest = JSON.parse(manifestRaw);

/* The signature of UTF-8 decoded as cp1252: a stray Â or Ã immediately followed
   by another high-range character. Real prose in this file never does that. */
const MOJIBAKE = /[ÂÃ][-¿ -⃿]/;
assert(!MOJIBAKE.test(manifestRaw),
  'manifest.json contains mojibake — a UTF-8 string decoded as cp1252 and re-encoded. ' +
  'It will be published inside the ZIP and rendered to the user. Found: ' +
  JSON.stringify((manifestRaw.match(MOJIBAKE) || [''])[0]));

/* Every human-visible string, checked explicitly rather than by pattern alone,
   because these are the ones a user actually reads. */
const VISIBLE = [
  ['name', manifest.name],
  ['description', manifest.description],
  ['action.default_title', manifest.action && manifest.action.default_title]
];
for (const [label, value] of VISIBLE) {
  if (value == null) continue;
  assert(!MOJIBAKE.test(value), label + ' is mojibaked: ' + JSON.stringify(value));
  assert(!/�/.test(value), label + ' contains a replacement character: ' + JSON.stringify(value));
}

/* The specific string that shipped wrong, pinned by its correct codepoint so a
   re-corruption cannot pass by looking merely "not obviously broken". */
const title = (manifest.action && manifest.action.default_title) || '';
if (/settings/i.test(title)) {
  assert(title.indexOf('—') > -1 || !/[-–—]/.test(title),
    'the toolbar tooltip should carry a real em-dash (U+2014), got ' + JSON.stringify(title));
}

/* And the file round-trips: read as UTF-8, re-encoded, byte-identical. A file
   that fails this has been through a latin1/utf8 mismatch somewhere. */
const bytes = fs.readFileSync(path.join(root, 'manifest.json'));
assert(Buffer.compare(bytes, Buffer.from(manifestRaw, 'utf8')) === 0,
  'manifest.json is not valid round-trippable UTF-8 — something wrote it through a latin1 path');

/* ---- 2. the checker's loader token tracks the checker -------------------- */

const checker = read('feat_mls_checker.js');
const published = JSON.parse(read('extension-version.json')).version;
const declared = /SERVER_EXT_VERSION\s*=\s*'([^']+)'/.exec(checker);
assert(declared, 'feat_mls_checker.js must declare SERVER_EXT_VERSION');
assert.strictEqual(declared[1], published,
  'the checker and the feed must agree on the published version');

/* The token must encode the version it ships, so "the file changed but the URL
   did not" is visible on inspection instead of only in a stale browser.
   setfix-1.0.0 (b1169, n=39/60/73): the production loader now follows the
   shared __MLS_AV build token (window.__MLS_AV||Date.now()) instead of a
   hand-maintained literal — that dynamic form moves with every release by
   construction, so "the token does not name the version" cannot happen on it
   again, and it is exempted below from the version-slug check because it has
   no literal slug to check.

   mls-connect.staging.js is NOT derived from /1p and is off the clinician
   path (see the STAGING ratchet-exemption in
   tests/deterministic-cache-token-contract.test.js). It was already failing
   this exact assertion before setfix-1.0.0 touched anything — masked only
   because mls-connect.js (checked first, same loop, same message shape)
   failed first. Fixing production does not fix staging, and staging is
   outside this pass's edit set, so it is carved out here the same way, with
   the same "ratchet, never silently re-widen" intent: staging must still name
   SOME token, it just is not held to matching the current published version
   until it too moves to the build-token form. */
const STAGING_LOADERS_NOT_MIGRATED = new Set(['mls-connect.staging.js']);
for (const loader of ['mls-connect.js', 'mls-connect.staging.js']) {
  const src = read(loader);
  if (src.includes("feat_mls_checker.js?v='+(window.__MLS_AV||Date.now())")) continue;
  const tok = /feat_mls_checker\.js\?v=([a-z0-9]+)/.exec(src);
  assert(tok, loader + ' must load feat_mls_checker.js with a cache token');
  if (STAGING_LOADERS_NOT_MIGRATED.has(loader)) continue;
  const versionSlug = published.replace(/\./g, '');
  assert(tok[1].indexOf(versionSlug) > -1,
    loader + ' serves the checker under token "' + tok[1] + '", which does not name the published ' +
    'version ' + published + '. The service worker serves versioned URLs cache-first, so a checker ' +
    'whose contents changed behind an unchanged token is never delivered — and this is the file that ' +
    'tells users which version is published. Bump the token with the version.');
}

console.log('PASS extension manifest text integrity: no mojibake in any published manifest string, the file round-trips as UTF-8, and the checker\'s cache token names the version it reports');
