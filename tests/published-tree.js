'use strict';
/*
 * WHAT GITHUB PAGES ACTUALLY PUBLISHES - one reader, used by every live harness
 * -----------------------------------------------------------------------------
 * Every live harness serves the repo over http and drives the real app. For that
 * to mean anything it has to serve the build the doctor RECEIVES, not the build
 * the repo happens to contain. Getting that boundary wrong has now cost this
 * repo twice, in opposite directions:
 *
 *   Serving the repo wholesale reported 13 phantom "duplicate visible control"
 *   defects on the Templates tab - two Upload buttons, two Upload-folder, two
 *   Delete-all - every one contributed by feat_mls_staging_pack1.js, which IS
 *   excluded and therefore 404s live. Defects that do not exist.
 *
 *   The fix for that then over-corrected. Each harness grew its own regex,
 *   `/^\s*-\s*"([^"]+\.js)"/gm` over the WHOLE of _config.yml - but that file
 *   holds two lists: `exclude:` (lines 17-97) and `include:` (98-150). The
 *   include list is not a second exclude list, it is the opposite: the allowlist
 *   that re-opens reviewed files Jekyll would otherwise drop. So the harnesses
 *   began 404ing seven files that ARE published, among them
 *   public-preview-policy.js and public-preview-runtime.js, which ScribeFlow.html
 *   loads in <head> on every single page load. Defects that do exist, hidden.
 *
 * Both failures are the same mistake - deriving the publication boundary instead
 * of reading it - so this module stops deriving it.
 *
 * pages-publication-inventory.json is the boundary, stated exactly: 331 paths,
 * and scripts/audit-pages-build.js checks a REAL jekyll-build-pages output tree
 * against it in CI, byte for byte, failing on any file missing from the build
 * and any file in the build that is not in the inventory. Reproducing Jekyll's
 * exclude/include precedence in a harness would be a second implementation of
 * something already pinned by an executed build; asking the inventory is asking
 * the thing CI already proved.
 *
 * Fails CLOSED on an unknown path - not in the inventory means not served -
 * because that is precisely the direction that catches "the app loads a file
 * production does not have". The 404 is the finding.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function inventoryPaths(inventoryPath) {
  const file = inventoryPath || path.join(ROOT, 'pages-publication-inventory.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(doc) ? doc : doc.paths;
  if (!Array.isArray(list) || !list.length) {
    throw new Error('pages-publication-inventory.json has no path list; a harness cannot know what is published');
  }
  return list;
}

/* THE ONE THING A LIVE HARNESS MAY SERVE THAT PAGES DOES NOT.
 *
 * _config.yml excludes `api/` and it is right to. On the live site signup runs
 * in BACKEND mode: loadSignupAgreementManifest() fetches bkBase() +
 * /api/agreements/signup-manifest from the real server, and
 * scripts/public-release-preflight.js checks that route answers 200 with a
 * counsel-approved manifest before a release ships. Nothing about signup depends
 * on Pages serving that path, and publishing the checked-in file would put a
 * manifest marked syntheticTestFixture:true, counselApproved:false,
 * clinicalUseAuthorized:false on the public origin. It must stay unpublished.
 *
 * But a live harness has no backend. Without this file the assent fieldset never
 * enables - correctly, that is the fail-closed behaviour - and no harness can
 * get past the sign-up screen to test anything at all. The repo already keeps
 * api/agreements/signup-manifest precisely for that: a loopback stand-in the app
 * accepts ONLY in demo mode and hosted mode rejects outright
 * (tests/signup-assent-manifest-runtime.test.js proves both directions).
 *
 * So it is served, by exact path, named here and nowhere else. Everything else
 * fails closed. This is the difference between "the harness stands in for the
 * backend" and "the harness serves the repo", and the second one is what
 * produced 13 defects that did not exist. */
const BACKEND_STANDINS = new Set(['api/agreements/signup-manifest']);

/* rel is the request path with no leading slash and no query string. */
function makeIsPublished(inventoryPath) {
  const published = new Set(inventoryPaths(inventoryPath));
  return function isPublished(rel) {
    const clean = String(rel || '').replace(/^\.?\//, '');
    return published.has(clean) || BACKEND_STANDINS.has(clean);
  };
}

module.exports = { inventoryPaths, makeIsPublished, BACKEND_STANDINS, ROOT };
