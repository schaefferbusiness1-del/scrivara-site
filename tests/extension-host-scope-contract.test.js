'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

const serialized = JSON.stringify(manifest);
assert(!serialized.includes('<all_urls>'), 'MLS Assist still requests blanket access to every website');

const core = (manifest.content_scripts || []).find(entry =>
  Array.isArray(entry.js) && entry.js.includes('content.js') && entry.js.includes('mls-popup.js'));
assert(core, 'the MLS/Athena core content-script entry is missing');
assert(core.matches.includes('https://athenanet.athenahealth.com/*'), 'core extension is not bound to exact athenaOne');
assert(core.matches.includes('https://mlsscribe.com/*'), 'core extension is not bound to MLS Scribe');
assert(core.matches.includes('http://127.0.0.1/*') && core.matches.includes('http://localhost/*'), 'synthetic local testing hosts are missing');
assert(core.matches.every(pattern => /athenanet\.athenahealth\.com|mlsscribe\.com|localhost|127\.0\.0\.1/.test(pattern)),
  'core extension still injects into an unrelated website');

const reviews = (manifest.content_scripts || []).find(entry =>
  Array.isArray(entry.js) && entry.js.length === 1 && entry.js[0] === 'ext_reviews_reader.js');
assert(reviews && reviews.matches.length >= 8, 'public review reader lacks its explicit site allowlist');
assert(reviews.matches.every(pattern => /google\.com|maps\.app\.goo\.gl|g\.page|healthgrades|vitals|webmd|ratemds|zocdoc|yelp|facebook/.test(pattern)),
  'review reader is allowed on a site outside its audited public-review list');
assert(reviews.matches.includes('https://www.google.com/maps/*') && reviews.matches.includes('https://maps.google.com/*'),
  'review reader is missing its exact Google Maps paths');
assert(!reviews.matches.includes('https://*.google.com/*'),
  'review reader still injects across unrelated Google products');

assert(/function mlsLoopbackOrigin\(origin\)/.test(content), 'loopback privacy boundary is missing');
assert(/mlsLoopbackOrigin\(origin\)[\s\S]{0,260}d\.type !== 'mlsPing'[\s\S]{0,180}d\.type !== 'mlsExtHealth'/.test(content),
  'loopback can drive a bridge verb beyond PHI-free ping/health');
assert(/reason:\s*'loopback-synthetic-only'/.test(content), 'loopback refusal does not return a stable reason');

console.log('PASS extension host scope: no all-URL injection; core is MLS/Athena-only and localhost is PHI-blocked');
