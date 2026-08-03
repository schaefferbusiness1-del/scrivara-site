'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

/* 2026-07-21 (owner directive): MLS Scribe is confirmed HIPAA compliant. The
   public posture moves from "synthetic evaluation only" to accurate
   HIPAA-compliant production language — WITHOUT claiming certifications,
   audits, endorsements, or guarantees, and WITHOUT enabling purchasing. The
   storage-honesty and no-BAA-by-browsing pins stay: those remain facts. */
const privacy = read('privacy.html');
assert(/MLS Scribe is HIPAA compliant/i.test(privacy), 'privacy must state the confirmed HIPAA posture');
assert(!/limited to synthetic evaluation/i.test(privacy), 'outdated synthetic-only boundary must be gone from privacy');
assert(/does not itself create or execute a Business Associate Agreement/i.test(privacy), 'the policy must not pretend to be a BAA');
assert(/browser storage is readable\/compressed application storage, not AES-encrypted/i.test(privacy));
assert(/optional per-device mode[\s\S]{0,300}?stored in that browser's local storage/i.test(privacy));
assert(!/Encryption at rest<\/strong>[\s\S]{0,80}?AES-256/i.test(privacy), 'privacy page still promises universal AES-at-rest storage');
assert(!/Encrypted backups<\/strong>[\s\S]{0,80}?AES-256/i.test(privacy), 'privacy page still promises active AES backups');
assert(!/third-party API keys[\s\S]{0,120}?reside only on the MLS backend/i.test(privacy), 'privacy page still hides the local-demo key exception');

const terms = read('terms.html');
assert(/Evaluation &amp; Site Terms/.test(terms), 'terms carry the current title');
assert(!/Synthetic Evaluation Terms/.test(terms), 'the synthetic-era title must be gone');
assert(/Self-service checkout, paid subscriptions, renewals[\s\S]{0,200}?disabled/i.test(terms), 'purchasing stays held');
assert(/Enter PHI only through an authorized, signed-in account/i.test(terms), 'PHI is scoped to authorized accounts under executed agreements');
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
assert(/HIPAA compliant/i.test(assist), 'assist states the confirmed HIPAA posture');
assert(!/synthetic evaluation only/i.test(assist), 'outdated synthetic-only language must be gone from assist');

const download = read('get-extension.html');
assert(/MLS_Assist_v3\.0\.44\.zip/.test(download) &&
  /54622758c4e1543c24560a9bba649ad446ebebaabf47052aab1174fcd6f4bb77/i.test(download) &&
  !/Manual candidate package withheld/i.test(download));
assert(!/\bJSZip\b|var\s+FILES\s*=|\/manifest\.json\?/.test(download));
assert(/Chrome Web Store/.test(download));

/* The page must never name a version other than the one the link serves.
 * It did: the label read "Download MLS Assist v3.0.4" while the href pointed
 * at MLS_Assist_v3.0.44.zip, because the label was hand-maintained and the
 * release lane only moved the href, the download attribute and the digest.
 * A reader following the printed instruction to verify the digest would have
 * found a mismatch against the version they thought they were getting.
 * So: no hard-coded vN.N.N may appear in the download control's own markup -
 * it is filled at runtime from the href - and any version string elsewhere on
 * the page must match the offered file. */
const dlAnchor = download.match(/<a\s+id=["']dl["'][\s\S]*?<\/a>/i);
assert(dlAnchor, 'download control must be a single anchor with id="dl"');
const offered = download.match(/href=["']MLS_Assist_v(\d+(?:\.\d+){0,3})\.zip["']/i);
assert(offered, 'download control must serve a stamped MLS_Assist_vN.zip');
for (const stated of dlAnchor[0].match(/\bv\d+(?:\.\d+){1,3}\b/g) || []) {
  assert.strictEqual(stated, 'v' + offered[1],
    `download control names ${stated} but serves v${offered[1]} - the label must be derived from the href, not typed`);
}
assert(/getAttribute\(['"]href['"]\)[\s\S]{0,200}MLS_Assist_v/.test(download),
  'the version label must be derived from the href at runtime so it cannot drift again');
assert(!/same bytes as the Web Store build/i.test(download),
  'the page must not assert ZIP/Web-Store byte equality it cannot verify from here');
const feed = JSON.parse(read('extension-version.json'));
/* 3.0.27 released 2026-07-28: chart history finally captures the PROBLEM LIST.
   Measured on the owner account for Wed 2026-07-29 (19 appointments): problems
   stored for 6, meds 0/19, vitals 0/19, and a signed-IN pull wrote ZERO
   characters while reporting "history 19/19, failures 0" - against charts that
   hold, on one measured patient, seven active problems over 740 characters.

   Cause: TWO SURFACES. /ax/appointment/<apptId>/briefing carries Active Problems
   but has NO patient banner (it shows only the provider). The clinical chart has
   the banner and no Active Problems. mlsEnsureClinicalChartFn deliberately
   navigates AWAY from the briefing because v1.59 found that without that nudge
   "the reader returned the provider as the patient and the pull refused
   everything". So the reader moved toward identity and away from the data, and
   both halves were individually correct.

   3.0.27 reads the briefing BEFORE that navigation and carries it out as its own
   response field, merged only at the hand-off to the chart parser. Identity
   verification is untouched. Notably it does NOT inject a synthetic frame into
   the read: that design was traced first and REJECTED, because such a frame
   survives the noise filter, scores into the ranked set, then fails
   frameBoundToTarget and returns before the merge - so the text never arrives at
   all, and unboundClinicalFrames !== 0 makes three separate coverage gates
   refuse the whole read. It would have taken the measured 6-of-19 capture to
   0-of-19: the v1.59 outcome by another route.

   3.0.26 released 2026-07-27, and it is what makes 3.0.25 real. 3.0.25 taught
   the day driver to declare out.dateUnverified on a surface it cannot read, but
   the ONE place in the whole extension that consumes out.done/out.schedDate did
   not check that flag - so the echo branch still made the guard compare target
   to target, the exact tautology 3.0.25 claimed to remove, and an appointment
   could be opened on a date nobody confirmed. That consumer now refuses an
   unverified date. Found by adversarially auditing 3.0.25's own reachability:
   the repaired fields were, as shipped, read nowhere that respected them.
   3.0.25 was published to the site but never uploaded to the Web Store, so
   3.0.26 supersedes it as the store candidate.

   3.0.25 released 2026-07-27: every day-navigation strategy now reads the
   schedule header BACK and reports the day athenaOne is ACTUALLY showing.
   Two lanes were guessing. The week-strip lane echoed the day it was ASKED
   for, which made the app-side date check compare target to target - a
   tautology, so a wrong-surface pull imported the wrong date while reporting
   success. The date-input lane never read the header at all and never set
   schedDate, so a day it HAD reached failed the same check and surfaced as
   "Athena could not be opened to the requested day": a false negative on a
   healthy pull, which is the error the owner actually saw. The chart-identity verb
   gained an 8s budget so a wedged read answers honestly instead of never
   answering; audioCapture and offscreen - two permissions with no code path -
   were dropped from the manifest.
   The feed must announce it for the proven owner-side auto-reload to fetch
   it; the release is only CLAIMED running on a pong reporting 3.0.25.
   Earlier: 3.0.24 2026-07-27 (Mac fixes: empty-platform fullscreen race,
   macOS mic guidance, wider getUserMedia refusal regex, min Chrome 116);
   3.0.23 2026-07-27 (mlsAppChartIdentity bridge verb for the bidirectional
   follow); 3.0.5 2026-07-24; 3.0.4 2026-07-21 (label-only delta on the 3.0.0
   core), each loaded and live-verified before its pin move. */
assert.strictEqual(feed.version, '3.0.44', 'public feed must state the released stable channel exactly');

const lawyers = read('lawyers.html');
assert(!/ipapi\.co|ipwho\.is|get\.geojs\.io|detectState\s*\(/i.test(lawyers));
assert(!/fetch\s*\(\s*REQUEST_ENDPOINT|const\s+REQUEST_ENDPOINT/i.test(lawyers));
assert(/Case intake is unavailable/i.test(lawyers));

const index = read('index.html');
assert(/MLS Scribe is HIPAA compliant/i.test(index), 'index states the confirmed HIPAA posture');
assert(!/does not currently claim HIPAA compliance/i.test(index), 'the outdated HIPAA disclaimer must be gone');
assert(!/Security evaluation in progress/i.test(index), 'the outdated security-under-evaluation card must be gone');
assert(/No independent certification/i.test(index), 'no certification/audit claim may be implied');
assert(/Checkout and subscriptions are disabled/i.test(index));
assert(/No testimonial is presented as verified/i.test(index));
assert(!/kickstarter\.com/i.test(index));

console.log('PASS public release truth: synthetic boundary, honest storage/legal/install claims, no silent location or unsupported offer');
