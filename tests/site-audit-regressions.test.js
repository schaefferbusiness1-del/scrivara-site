'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const redesign = read('feat_mls_redesign.js');
const loading = read('feat_mls_loading_calm.js');
const home = read('index.html');
const app = read('ScribeFlow.html');
const directory = read('lawyers.html');
const profile = read('expert.html');
const portal = read('patient-portal.html');
const siteBundle = read('mls-connect.js');

new Function(redesign); // eslint-disable-line no-new-func
new Function(loading); // eslint-disable-line no-new-func

assert(redesign.includes('#mlsRdSearchSlot{ flex:0 0 38px !important; min-width:38px !important; width:38px !important; }'), 'mobile search slot must not squeeze the page title');
assert(redesign.includes('#mlsRdKbd{ display:none !important; }'), 'mobile icon-only search must not retain the slash key badge');
assert(redesign.includes('#mlsFab, #mlsFabMenu{ display:none !important; }'), 'mobile quick actions must not float over working controls');
assert(redesign.includes('#mlsRdNewBtn{ display:inline-flex !important; width:38px;'), 'mobile quick actions need one compact top-bar owner');
assert(redesign.includes('#mlsAsstFab, #mlsDaDock, #mlsTabPickerChip'), 'the duplicate fixed dictate control must be absent on phones');
assert(siteBundle.includes("feat_mls_redesign.js?v=20260716rd312"), 'the repaired responsive/performance asset needs a fresh deployment URL');

assert(loading.includes("p.setAttribute('role', 'status')"), 'busy pill needs status semantics');
assert(loading.includes("p.setAttribute('aria-live', 'polite')"), 'busy pill needs polite announcements');
assert(loading.includes("p.setAttribute('aria-hidden', 'true')") && loading.includes("p.setAttribute('aria-hidden', 'false')"), 'busy pill must leave and re-enter the accessibility tree with its visual state');
assert(loading.includes('opacity:0;visibility:hidden;'), 'idle busy pill must be visually and semantically hidden');
assert(siteBundle.includes("feat_mls_loading_calm.js?v=20260714audit1"), 'the repaired loading asset needs a fresh deployment URL');

assert.strictEqual((home.match(/id="mlsChatBtn"/g) || []).length, 1, 'homepage needs one sales-chat button');
assert(home.includes('#mlsChatBtn{position:static;right:auto;bottom:auto;'), 'mobile sales chat must participate in layout instead of covering CTAs');
assert(home.includes('<a href="#demo">Book a demo</a>'), 'homepage footer must link to a configured booking destination');
assert(!home.includes('<a href="easy-book.html">Book</a>'), 'homepage must not send visitors to an unconfigured booking widget');

assert(app.includes('id="appFooterNotice"'), 'app footer notice needs a stable owner');
assert(app.includes('This local demo stores its synthetic patient and note data only in this browser on this device.'), 'local demo must describe local storage truthfully');
assert(portal.includes('booking.removeAttribute("href")') && portal.includes('Booking available after sign-in'), 'sample portal must not open an unconfigured booking link');

assert(directory.includes('sample profile;\\s*edit your board certifications here'), 'directory must strip backend profile-edit instructions');
assert(profile.includes('function publicCredentials') && profile.includes('function publicExperience') && profile.includes('function publicDocuments'), 'public profile needs placeholder sanitizers');
assert(profile.includes("if(/board[ -]?cert/i.test(credentials))"), 'board certification badge must use cleaned public credentials');
assert(profile.includes("if(/24[ -]?hour/i.test(availability))"), 'turnaround badge must be based on published availability');
assert(profile.includes('if(documents.length)') && profile.includes('+documents.map('), 'placeholder documents must be filtered before rendering');

for (const html of [home, directory, profile, portal]) {
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|application\/ld\+json/i.test(match[1])) continue;
    new Function(match[2]); // eslint-disable-line no-new-func
  }
}

console.log('PASS full-site audit regressions: mobile ownership, loading access, public profile hygiene, booking truth, and demo storage');
