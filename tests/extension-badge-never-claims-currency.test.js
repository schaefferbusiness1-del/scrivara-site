'use strict';
/*
 * The Settings extension badge may never claim currency it has not proven.
 *
 * WHAT SHIPPED. The "🩺 MLS Assist browser extension" card in Settings carried a
 * hardcoded green pill reading the literal words "Latest version". No code had
 * asked the extension anything at that point, and nothing ever removed those
 * words if the version feed was unreachable — so the sentence a doctor read
 * ("you have the latest") was written months earlier by a person, not derived
 * from the browser in front of them.
 *
 * The dynamic writer that replaced it was only half a fix. It emitted
 * "Installed: v<x>" whenever the extension answered — in the SAME green pill,
 * comparing nothing — so a two-releases-old install rendered as a pass; and
 * "Latest: v<y>" from the feed when the extension had NOT answered, which reads
 * as an installed version but is the published one.
 *
 * The rule, from the contract: never state a positive the system cannot back.
 * "Up to date" requires BOTH that the extension itself announced a version
 * (window.__mlsExtReportedVersion, set only by the mlsExtVersion postMessage
 * handshake) AND that the announced version is not older than the published
 * stable channel (/extension-version.json, which
 * tests/extension-package.test.js pins equal to feat_mls_checker's
 * SERVER_EXT_VERSION).
 *
 * THIS GATE WAS PROVEN IN BOTH DIRECTIONS before it was trusted, per the rule
 * earned by the b669 clearance gate:
 *   - restoring the literal "Latest version" pill in ScribeFlow.html fails
 *     assertion 1;
 *   - restoring the uncompared `loaded ? 'Installed: v'+loaded : 'Latest: v'+VER`
 *     expression fails assertions 3 and 4;
 *   - the real tree passes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const published = JSON.parse(fs.readFileSync(path.join(root, 'extension-version.json'), 'utf8'));

/* ---- 1. the static badge states no verdict at all --------------------------- */
const badge = /<span data-mls-extension-version="1"[^>]*>([^<]*)<\/span>/.exec(app);
assert(badge, 'the Settings extension-version badge span is gone');
const badgeText = badge[1].trim();
assert(!/latest|up to date|current|installed/i.test(badgeText),
  'the static extension badge claims a version verdict before anything has asked the extension: ' + JSON.stringify(badgeText));
assert(badgeText.length > 0, 'the static extension badge is empty — it must say that it is still looking');

/* ---- 2. the card still points at the update path ---------------------------- */
assert(/get-extension\.html/.test(app), 'the extension card lost its download/update route');
assert(app.includes('MLS_Assist_v' + published.version + '.zip'),
  'the direct package link no longer names the published channel version v' + published.version);

/* ---- 3. "up to date" is reachable ONLY behind a handshake AND a comparison --- */
const start = connect.indexOf('function badgeState()');
assert(start > 0, 'badgeState() is gone — the badge no longer derives its own text');
const writer = connect.slice(start, connect.indexOf('function applyBadge()', start));
assert(/__mlsExtReportedVersion/.test(writer), 'the badge no longer reads the extension handshake');
assert(/verCmp\(loaded, VER\)/.test(writer), 'the badge no longer compares the installed version against the published one');

const upToDate = writer.indexOf('up to date');
assert(upToDate > 0, 'the up-to-date state is gone');
/* Every early return that can produce text must run BEFORE the up-to-date line,
   so reaching it implies a handshake, a published version, and cmp >= 0. */
for (const guard of ['if (!VER && !loaded) return null;', 'if (!loaded) return', 'if (!VER) return', 'if (cmp === null) return', 'if (cmp < 0) return']) {
  const at = writer.indexOf(guard);
  assert(at > 0 && at < upToDate,
    'the up-to-date claim is no longer guarded by: ' + guard);
}

/* ---- 4. no handshake is reported as no handshake, never as a version -------- */
assert(/Not detected here · published v/.test(writer),
  'a browser with no extension handshake no longer says so — it must not report the published version as if it were installed');
assert(!/'Latest: v'/.test(connect),
  'the badge can render the published version under a "Latest:" label again, which reads as an install claim');

/* ---- 5. the poll may not freeze on the pre-handshake state ------------------ */
const poll = connect.slice(connect.indexOf('function start(){', start), connect.indexOf('function start(){', start) + 1400);
assert(!/if \(applyBadge\(\) \|\| tries > 40\) clearInterval/.test(poll),
  'the badge poll stops on its FIRST write again — the extension answers at ~6s, so that freezes "Not detected here" on a browser that is running the extension');
assert(/window\.__mlsExtReportedVersion && !!VER/.test(poll),
  'the badge poll no longer waits for a handshake-backed verdict before it stops');

console.log('PASS extension badge: no static currency claim, "up to date" only behind handshake + comparison, missing handshake reported honestly, poll waits for the answer');
