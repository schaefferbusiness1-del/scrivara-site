#!/usr/bin/env node
'use strict';

/*
 * A DEPLOY THAT GOES BACKWARDS IS A SILENT REVERT, AND IT REPORTS SUCCESS.
 * -----------------------------------------------------------------------------
 * MEASURED, not theorised. Across the successful Pages runs on 2026-08-06 the QA
 * lane recorded 13 deploys and 3 INVERSIONS — a 23% rate:
 *
 *   23:07:40  b904 deployed AFTER b905
 *   23:15:05  b905 deployed AFTER b906
 *   23:26:01  b908 deployed AFTER b909
 *
 * Each served an OLDER tree until the next deploy happened to overtake it. The
 * first reverted two shipped fixes for 23 minutes. The third reverted another
 * lane's `appControl` guard — the fix for a doctor being silently sent to the
 * wrong screen — 51 seconds after it landed. Every one of those runs reported
 * SUCCESS, and app-version.json went BACKWARDS twice with nothing raising a flag.
 *
 * Pages runs one concurrency group but the DEPLOY job is what publishes, and a
 * queued older run can reach it after a newer one. So this check has to happen in
 * the deploy job, as late as possible — a build-time check passes and the
 * inversion still occurs afterwards.
 *
 * WHAT IT BLOCKS: only the inversion. `scripts/bump-build.js` guarantees a lane
 * moving forward always carries a higher number, so a genuine ship can never trip
 * this. An equal number PASSES: re-running a deploy for the same build is
 * legitimate and must not be blocked.
 *
 * WHY IT FETCHES FROM THE RUNNER: app-version.json is served through the site,
 * and this repo has proven that a service worker can serve stale copies of site
 * assets to a BROWSER. The runner has no service worker, so a cache-busted fetch
 * here is clean — but never port this check into a browser context, where the
 * "current" reading could itself be a stale worker's cached copy and would let a
 * real inversion through.
 *
 * FAIL DIRECTION: if the live version cannot be read at all (network fault, first
 * ever deploy, malformed file) this PASSES with a loud note. A deploy pipeline
 * that refuses to publish because a status endpoint blipped would be a worse
 * outage than the one it prevents, and the failure it exists to catch is
 * unambiguous when the data is present.
 *
 * Usage:  node scripts/assert-forward-deploy.js --artifact <bNNN|path> [--live-url <url>] [--live <bNNN>]
 */

const fs = require('fs');

function parseBuild(text) {
  const m = /\bb(\d{3,5})\b/.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

function readArtifactBuild(value) {
  if (!value) return null;
  const direct = parseBuild(value);
  /* a bare token like "b904" */
  if (direct !== null && !/[\\/]/.test(value) && !fs.existsSync(value)) return direct;
  try { return parseBuild(fs.readFileSync(value, 'utf8')); } catch (e) { return direct; }
}

async function readLiveBuild(url) {
  const bust = url + (url.indexOf('?') === -1 ? '?' : '&') + 'nc=' + Date.now();
  const res = await fetch(bust, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error('live app-version.json responded ' + res.status);
  return parseBuild(await res.text());
}

/* The whole decision, isolated so it can be unit-tested without a network. */
function verdict(artifact, live) {
  if (artifact === null) {
    return { ok: true, code: 'artifact-unreadable', message: 'could not read a build number from the artifact — not blocking the deploy' };
  }
  if (live === null) {
    return { ok: true, code: 'live-unreadable', message: 'could not read the live build number — not blocking the deploy' };
  }
  if (artifact < live) {
    return {
      ok: false, code: 'inversion',
      message: 'REFUSING TO PUBLISH: this artifact is b' + artifact + ' but the live site already serves b' + live + '.\n' +
        'Publishing it would serve an OLDER tree and silently revert whatever landed in between —\n' +
        'measured 3 times on 2026-08-06, once reverting another lane\'s fix 51 seconds after it shipped.\n' +
        'This run is behind: let the newer deploy stand, then re-run from an up-to-date branch.'
    };
  }
  if (artifact === live) {
    return { ok: true, code: 'same-build', message: 'artifact b' + artifact + ' equals the live build — a re-deploy of the same tree, allowed' };
  }
  return { ok: true, code: 'forward', message: 'artifact b' + artifact + ' is ahead of live b' + live + ' — forward deploy' };
}

module.exports = { verdict, parseBuild, readArtifactBuild };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const arg = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : null; };
    const artifact = readArtifactBuild(arg('artifact') || '_site/app-version.json');
    let live = arg('live') ? parseBuild(arg('live')) : null;
    if (live === null) {
      const url = arg('live-url') || 'https://mlsscribe.com/app-version.json';
      try { live = await readLiveBuild(url); }
      catch (e) { console.log('forward-deploy guard: ' + e.message + ' — not blocking'); process.exit(0); }
    }
    const out = verdict(artifact, live);
    console.log('forward-deploy guard [' + out.code + ']: ' + out.message);
    process.exit(out.ok ? 0 : 1);
  })();
}
