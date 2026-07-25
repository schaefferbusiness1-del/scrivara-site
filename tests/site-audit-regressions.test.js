'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const redesign = read('feat_mls_redesign.js');
const loading = read('feat_mls_loading_calm.js');
const progress = read('feat_mls_progress_stages.js');
const home = read('index.html');
const app = read('ScribeFlow.html');
const directory = read('lawyers.html');
const profile = read('expert.html');
const portal = read('patient-portal.html');
const siteBundle = read('mls-connect.js');
const studyGroups = read('feat_mls_studygroups.js');
const studyCalm = read('feat_mls_study_calm.js');
const studyAnalysis = read('feat_mls_task7_analysis_sg.js');

new Function(redesign); // eslint-disable-line no-new-func
new Function(loading); // eslint-disable-line no-new-func
new Function(progress); // eslint-disable-line no-new-func
new Function(studyGroups); // eslint-disable-line no-new-func
new Function(studyAnalysis); // eslint-disable-line no-new-func

assert(redesign.includes('#mlsRdSearchSlot{ flex:0 0 38px !important; min-width:38px !important; width:38px !important; }'), 'mobile search slot must not squeeze the page title');
assert(redesign.includes('#mlsRdKbd{ display:none !important; }'), 'mobile icon-only search must not retain the slash key badge');
assert(redesign.includes('#mlsFab, #mlsFabMenu{ display:none !important; }'), 'mobile quick actions must not float over working controls');
assert(redesign.includes('#mlsRdNewBtn{ display:inline-flex !important; width:38px;'), 'mobile quick actions need one compact top-bar owner');
assert(redesign.includes('#mlsAsstFab, #mlsDaDock, #mlsTabPickerChip'), 'the duplicate fixed dictate control must be absent on phones');
assert(siteBundle.includes("feat_mls_redesign.js?v=20260725rd324"), 'the repaired responsive/performance asset needs a fresh deployment URL');

assert(loading.includes("visualOwner: 'mlsProgressStages'") && !loading.includes('window.fetch = wrapped'),
  'shared loading store must stay headless and must not turn background requests into UI');
assert(progress.includes("p.setAttribute('role', 'log')"), 'single progress details owner needs log semantics');
assert(progress.includes("p.setAttribute('aria-live', 'polite')"), 'single progress details owner needs polite announcements');
assert(progress.includes("c.setAttribute('aria-label', 'Show progress details')"), 'single progress chip needs an accessible label');
assert(progress.includes("'#' + CHIP_ID + '{") && progress.includes('display:none') && progress.includes("'#' + CHIP_ID + '.on{display:inline-flex}'"),
  'idle progress chip must remain absent until an explicit job exists');
const loadingLoader = siteBundle.split(/\r?\n/).find(line => line.includes("var A='feat_mls_loading_calm.js',V='lb-2.1.0'")) || '';
assert(loadingLoader.includes("s.src=A+'?v=20260719lb204'") && loadingLoader.includes("s.setAttribute('data-mls-version',V)"),
  'the shared progress asset needs its exact version-aware fresh deployment URL');

assert(siteBundle.includes('feat_mls_studygroups.js') && siteBundle.includes('20260722sg1c6'), 'reconciled Study Groups mount needs a fresh deployment URL');
assert(studyGroups.includes('__MLS_PUBLIC_PREVIEW') && studyGroups.includes("skipped: 'public-synthetic-preview'"), 'read-only public preview still boots the hidden Study Groups/AI Studio surface');
assert(studyGroups.includes("document.querySelectorAll('[id=\"mls-sg-root\"]')") && studyGroups.includes("[0, 250, 1000, 3000, 8000]"), 'Study Groups no longer deduplicates and reconciles its late mount');
assert(!studyGroups.includes('id="mls-sg-athena"') && !studyCalm.includes('pull visits from Athena'), 'unverified Study Groups Athena-visit control remains visible');
assert(!studyAnalysis.includes('mls-sg-athena') && siteBundle.includes('feat_mls_task7_analysis_sg.js') && siteBundle.includes('A+"?v=20260722t7ac3"'), 'retired Study Groups Athena-visit enhancement remains loaded or callable');
assert(siteBundle.includes('A wrapper sentinel') && siteBundle.includes('head.setAttribute("aria-expanded"') && siteBundle.includes('if (sg.parentNode !== body) body.appendChild(sg)'), 'Study Groups shell does not repair incomplete header/body/root state');
assert(!siteBundle.includes('var sg = $("mls-sg-root"); if (!sg || $("mlsB39SgWrap"))'), 'Study Groups still trusts the broken wrapper-only sentinel');

assert.strictEqual((home.match(/id="mlsChatBtn"/g) || []).length, 1, 'homepage needs one sales-chat button');
assert(home.includes('#mlsChatBtn{position:static;right:auto;bottom:auto;'), 'mobile sales chat must participate in layout instead of covering CTAs');
assert(home.includes('<a href="#demo">Book a demo</a>'), 'homepage footer must link to a configured booking destination');
assert(!home.includes('<a href="easy-book.html">Book</a>'), 'homepage must not send visitors to an unconfigured booking widget');

assert(app.includes('id="appFooterNotice"'), 'app footer notice needs a stable owner');
assert(app.includes('This local demo stores its synthetic patient and note data only in this browser on this device.'), 'local demo must describe local storage truthfully');
assert(portal.includes('id="bookingBtn" type="button"') && portal.includes('openReq("appointment")'), 'portal booking must use the reviewed in-portal appointment-request flow');
assert(!portal.includes('easy-book.html') && !portal.includes('j.booking_url'), 'portal must not expose an unreviewed external or retired booking URL');

assert(directory.includes('sample profile;\\s*edit your board certifications here'), 'directory must strip backend profile-edit instructions');
assert(profile.includes('function publicCredentials') && profile.includes('function publicExperience') && profile.includes('function publicDocuments'), 'public profile needs placeholder sanitizers');
assert(directory.includes('if(d.released!==true)') && directory.includes('.filter(isReleasedProfile)'), 'directory must require explicit release and reject held profile content');
assert(profile.includes('d.released!==true||!isReleasedProfile(d.expert)'), 'profile detail must require explicit release and clean content');
assert(directory.includes('HELD_PROFILE_MARKER') && profile.includes('HELD_PROFILE_MARKER'), 'public profile surfaces must reject draft, sample, placeholder, lorem, and synthetic markers');
assert(directory.includes('No independently verified public experts are released yet') && profile.includes('No independently verified public expert profile is released here'), 'held public profiles need a calm, honest empty state');

for (const html of [home, directory, profile, portal]) {
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|application\/ld\+json/i.test(match[1])) continue;
    new Function(match[2]); // eslint-disable-line no-new-func
  }
}

console.log('PASS full-site audit regressions: mobile ownership, loading access, public profile hygiene, booking truth, and demo storage');
