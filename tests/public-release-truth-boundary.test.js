'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const privacy = read('privacy.html');
assert(/currently published build is limited to synthetic evaluation/i.test(privacy));
assert(/browser storage is readable\/compressed application storage, not AES-encrypted/i.test(privacy));
assert(/optional per-device mode[\s\S]{0,300}?stored in that browser's local storage/i.test(privacy));
assert(!/Encryption at rest<\/strong>[\s\S]{0,80}?AES-256/i.test(privacy), 'privacy page still promises universal AES-at-rest storage');
assert(!/Encrypted backups<\/strong>[\s\S]{0,80}?AES-256/i.test(privacy), 'privacy page still promises active AES backups');
assert(!/third-party API keys[\s\S]{0,120}?reside only on the MLS backend/i.test(privacy), 'privacy page still hides the local-demo key exception');

const terms = read('terms.html');
assert(/Synthetic Evaluation Terms/.test(terms));
assert(/not an offer of production clinical service/i.test(terms));
assert(/Self-service checkout, paid subscriptions, renewals[\s\S]{0,200}?disabled/i.test(terms));
assert(/Do not enter PHI or other real patient information/i.test(terms));
assert(/No BAA is executed by these terms/i.test(terms));
assert(!/subscriptions renew automatically/i.test(terms));
assert(!/currently 5%|platform fee disclosed/i.test(terms));
assert(!/founder rewards and other promotions are honored/i.test(terms));

const assist = read('assist.html');
for (const unsafe of [/any web EMR/i, /Capture whole chart/i, /Generate[^<]{0,80}?API key/i, /Load unpacked/i, /Developer mode/i]) {
  assert(!unsafe.test(assist), `assist page retains unsupported setup claim: ${unsafe}`);
}
assert(/existing MLS session/i.test(assist));
assert(/Staff prep &amp; Athena month pull/i.test(assist));
assert(/synthetic evaluation only/i.test(assist));

const download = read('get-extension.html');
assert(/Manual candidate package withheld/i.test(download) && /\bdisabled\b/.test(download));
assert(!/\bJSZip\b|var\s+FILES\s*=|\/manifest\.json\?/.test(download));
assert(/Chrome Web Store/.test(download));
const feed = JSON.parse(read('extension-version.json'));
assert.strictEqual(feed.version, '2.9.41', 'public feed must remain on the immutable known-good channel until candidate release');

const lawyers = read('lawyers.html');
assert(!/ipapi\.co|ipwho\.is|get\.geojs\.io|detectState\s*\(/i.test(lawyers));
assert(!/fetch\s*\(\s*REQUEST_ENDPOINT|const\s+REQUEST_ENDPOINT/i.test(lawyers));
assert(/Case intake is unavailable/i.test(lawyers));

const index = read('index.html');
assert(/synthetic evaluation/i.test(index));
assert(/Checkout and subscriptions are disabled/i.test(index));
assert(/No testimonial is presented as verified/i.test(index));
assert(/does not currently claim HIPAA compliance/i.test(index));
assert(!/kickstarter\.com/i.test(index));

console.log('PASS public release truth: synthetic boundary, honest storage/legal/install claims, no silent location or unsupported offer');
