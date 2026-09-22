/* fb-1.1 (3.0.55) - hardening the fatigue breaker for unattended firing.
 * 2026-08-08: a reload during interstitial weather killed a healthy frameset
 * (145-byte "unable to complete the requested action"; the root-bounce landed
 * on the SIGN-IN form; the owner's click was the only recovery - and he is
 * away). Non-negotiables (supervisor 2026-08-09):
 *   - probe for interstitial weather BEFORE every reload; if up, cool down
 *     and DO NOT reload;
 *   - after a reload, assert a real frameset came back; interstitial or
 *     sign-in => STOP the run loudly (no retry, no root-bounce);
 *   - hard absolute cap (3 reloads per service-worker lifetime) on top of
 *     the 15-min spacing and 2-per-hour bounds;
 *   - the breaker already fires only BETWEEN charts (at chart entry).
 * Latin1, all-or-nothing, count-guarded. */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}

/* ---- A. state gains the dead latch ---- */
const A = "  var __mlsHydFatigue = { streak: 0, lastRefreshAt: 0, hourAt: 0, refreshes: 0, pendingStamp: false };";
must(A, 'A-state');
const A2 = "  var __mlsHydFatigue = { streak: 0, lastRefreshAt: 0, hourAt: 0, refreshes: 0, pendingStamp: false, dead: '' };";
s = s.slice(0, s.indexOf(A)) + A2 + s.slice(s.indexOf(A) + A.length);

/* ---- B. the hardened refresh block replaces fb-1.0's ---- */
const B_OLD =
`      if (Date.now() - __mlsHydFatigue.hourAt > 3600000) { __mlsHydFatigue.hourAt = Date.now(); __mlsHydFatigue.refreshes = 0; }
      if (__mlsHydFatigue.streak >= 4 && Date.now() - __mlsHydFatigue.lastRefreshAt > 900000 && __mlsHydFatigue.refreshes < 2) {
        __mlsHydFatigue.lastRefreshAt = Date.now(); __mlsHydFatigue.refreshes++;
        __mlsHydFatigue.streak = 0; __mlsHydFatigue.pendingStamp = true;
        try { emit(appTabId, frozenRequestId, 'athenaOne is responding poorly - refreshing its tab and cooling down before this chart...', 0, 0); } catch (eFbE) {}
        try { await exec(emrId, [0], ['surfaceRefresh', cfg]); } catch (eFbR) {}
        await sleep(12000);
      }`;
must(B_OLD, 'B-fb10-block');
const B_NEW =
`      if (__mlsHydFatigue.dead) {
        /* fb-1.1: a refresh already came back wrong once. Refuse fast and
           loudly - no further reloads, no root-bounce, no grinding. The
           no-athena-tab reason routes into the day line's sign-in guidance. */
        return { ok: false, reason: 'no-athena-tab', identity: {}, visits: [], receipt: { complete: false, indexComplete: false, bodyComplete: false, fullDetail: false, fatigueDead: __mlsHydFatigue.dead }, error: 'MLS refreshed its athenaOne tab to recover from repeated read failures, and the tab did not come back as a signed-in athenaOne (' + __mlsHydFatigue.dead + '). Nothing further was attempted. Sign in to athenaOne, then pull again.' };
      }
      if (Date.now() - __mlsHydFatigue.hourAt > 3600000) { __mlsHydFatigue.hourAt = Date.now(); __mlsHydFatigue.refreshes = 0; }
      if (__mlsHydFatigue.streak >= 4 && Date.now() - __mlsHydFatigue.lastRefreshAt > 900000 && __mlsHydFatigue.refreshes < 2 && (__mlsHydFatigue.lifetimeRefreshes || 0) < 3) {
        __mlsHydFatigue.lastRefreshAt = Date.now();
        var fbPreR = null;
        try { var fbPre = await exec(emrId, [0], ['surfaceProbe', cfg]); fbPreR = bestResult(fbPre, function (r) { return r ? 1 : 0; }).result || null; } catch (eFbP) {}
        if (fbPreR && fbPreR.interstitial) {
          /* interstitial weather: reloading NOW is the 2026-08-08 mistake.
             Cool down without reloading; the spacing gate prevents a refire
             storm. streak stays - if the weather clears, the next window can
             still cure the tab. */
          try { emit(appTabId, frozenRequestId, 'athenaOne is showing its temporary-error page - waiting it out rather than reloading (a reload now can end the signed-in session)...', 0, 0); } catch (eFbW) {}
          await sleep(12000);
        } else {
          __mlsHydFatigue.refreshes++; __mlsHydFatigue.lifetimeRefreshes = (__mlsHydFatigue.lifetimeRefreshes || 0) + 1;
          __mlsHydFatigue.streak = 0; __mlsHydFatigue.pendingStamp = true;
          try { emit(appTabId, frozenRequestId, 'athenaOne is responding poorly - refreshing its tab and cooling down before this chart...', 0, 0); } catch (eFbE) {}
          try { await exec(emrId, [0], ['surfaceRefresh', cfg]); } catch (eFbR) {}
          await sleep(12000);
          var fbPostR = null;
          try { var fbPost = await exec(emrId, [0], ['surfaceProbe', cfg]); fbPostR = bestResult(fbPost, function (r) { return r ? 1 : 0; }).result || null; } catch (eFbQ) {}
          if (!fbPostR || fbPostR.interstitial || fbPostR.signIn || Number(fbPostR.frames || 0) < 2) {
            __mlsHydFatigue.dead = !fbPostR ? 'no-probe-answer' : (fbPostR.interstitial ? 'interstitial-after-reload' : (fbPostR.signIn ? 'sign-in-form-after-reload' : 'frameset-gone-after-reload'));
            try { emit(appTabId, frozenRequestId, 'After the refresh, athenaOne did not come back signed in (' + __mlsHydFatigue.dead + '). MLS stopped rather than retry - sign in to athenaOne, then pull again.', 0, 0); } catch (eFbD) {}
            return { ok: false, reason: 'no-athena-tab', identity: {}, visits: [], receipt: { complete: false, indexComplete: false, bodyComplete: false, fullDetail: false, fatigueDead: __mlsHydFatigue.dead }, error: 'MLS refreshed its athenaOne tab to recover from repeated read failures, and the tab did not come back as a signed-in athenaOne (' + __mlsHydFatigue.dead + '). Nothing further was attempted. Sign in to athenaOne, then pull again.' };
          }
        }
      }`;
s = s.slice(0, s.indexOf(B_OLD)) + B_NEW + s.slice(s.indexOf(B_OLD) + B_OLD.length);

/* ---- C. the page-side probe op (reload's honest eyes) ---- */
const C = "    if (op === 'surfaceRefresh') {";
must(C, 'C-op-site');
const probeOp =
`    if (op === 'surfaceProbe') {
      /* fb-1.1: read-only surface triage from the TOP frame. The 2026-08-08
         interstitial is a tiny no-frames page saying "unable to complete the
         requested action"; the sign-in form carries a USERNAME input. */
      var spTxt = '';
      try { spTxt = String((document.body && document.body.innerText) || '').slice(0, 4000); } catch (eSpT) {}
      var spSign = false;
      try { spSign = !!document.querySelector('input#USERNAME, input[name="USERNAME"], form[action*="login"] input[type="password"]'); } catch (eSpS) {}
      return { ok: true, frames: (function () { try { return window.frames.length; } catch (eSpF) { return 0; } })(), bytes: spTxt.length, interstitial: /unable to complete the requested action/i.test(spTxt), signIn: spSign };
    }
${C}`;
s = s.slice(0, s.indexOf(C)) + probeOp.slice(0, probeOp.length - C.length) + s.slice(s.indexOf(C));

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED fb-1.1 bytes ' + before + ' -> ' + s.length);
