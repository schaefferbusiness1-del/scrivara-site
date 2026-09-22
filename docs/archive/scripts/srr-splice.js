/* srr-1.0 (3.0.50) splice: surface-recycle rebind + shadow-aware briefing escape.
 * background.js is mixed-EOL - latin1 read, indexOf anchors, all-or-nothing write. */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}
function eolAfter(idx) {
  const nl = s.indexOf('\n', idx);
  if (nl < 0) { console.error('NO EOL'); process.exit(1); }
  return nl + 1;
}

/* ---- A. helper: visitsListFrameDocId ---- */
const A = '  async function waitForEncounterDetailFrames(tabId, parentFrameId, wantCount, timeoutMs, pollMs) {';
const ai = must(A, 'A-helper');
const helper =
`  async function visitsListFrameDocId(tabId, frameId) {
    /* srr-1.0: athenaOne's exam-prep/scheduling context REPLACES the visits
       document on its own ~25-30s cycle (measured live 2026-08-08 on the ax
       briefing: repeated full renavigation with every engine quiet). The
       documentId is the epoch: a changed id means every enumerate-time row
       stamp is gone, so re-clicking in that world is doomed. Same guard
       discipline as encounterDetailFrames; returns '' on any doubt so callers
       treat absence as UNKNOWN, never as proof of stability. */
    try {
      if (!chrome.webNavigation || typeof chrome.webNavigation.getAllFrames !== 'function') return '';
      var guard = __visitGuardByTab.get(Number(tabId)) || null;
      if (!guard || Date.now() >= Number(guard.deadline || 0)) return '';
      var settled = await settleVisitOp(chrome.webNavigation.getAllFrames({ tabId: tabId }), guard.deadline);
      if (!settled || !settled.ok) return '';
      var framesAll = settled.value || [];
      for (var fi = 0; fi < framesAll.length; fi++) {
        if (Number(framesAll[fi] && framesAll[fi].frameId) === Number(frameId)) return String(framesAll[fi].documentId || '');
      }
      return '';
    } catch (e) { return ''; }
  }
`;
s = s.slice(0, ai) + helper + s.slice(ai);

/* ---- B. epoch capture before the row phase ---- */
const B = '      var detailWaitMs = Math.max(300, Math.min(2500, Number(cfg.waitMs || 1400)));';
const bi = must(B, 'B-epoch');
const epoch =
`      /* srr-1.0: freeze the list document epoch the moment the verified index
         is accepted. Recycle detection during row reads compares against THIS. */
      var listDocId = await visitsListFrameDocId(emrId, listFrame);
      var surfaceResets = 0, surfaceResetOps = [];
`;
s = s.slice(0, bi) + epoch + s.slice(bi);

/* ---- C. recycle branch inside the cold-retry loop ---- */
const C = '          retryCount++; coldTries++;';
const ci = must(C, 'C-recycle');
const cAfter = eolAfter(ci);
const recycle =
`          /* srr-1.0 (3.0.50): before burning a cold retry, ask whether the row
             failed in a REPLACED world. athenaOne's exam-prep/scheduling context
             renavigates the visits surface on its own ~25-30s cycle; the fresh
             document carries none of the enumerate-time row stamps, so a plain
             re-click can never succeed there (Monday 2026-08-10 roster live:
             James x4 no-bound-clinical-detail, Christopher x1 accordion-not-open
             - all through TWO doomed cold retries). Detection is the documentId
             epoch; the cure is re-open + re-enumerate + the SAME identity gate +
             re-bind THIS row by its content-derived rowKey. Bounded to 3 per
             chart; every recycle lands on the receipt; an identity or row-set
             mismatch after a recycle fails closed - the contamination law
             outranks completeness. */
          if (surfaceResets < 3 && Date.now() + 5000 < readDeadline) {
            var srrDocNow = await visitsListFrameDocId(emrId, listFrame);
            if (srrDocNow && listDocId && srrDocNow !== listDocId) {
              surfaceResets++;
              surfaceResetOps.push({ index: i, reason: retryReason.slice(0, 40) });
              emit(appTabId, frozenRequestId, 'Athena refreshed the chart surface - rebinding encounter ' + (i + 1) + ' of ' + total + '\\u2026', i, total);
              await exec(emrId, null, ['openVisits', cfg]);
              await sleepWithinReadDeadline(1500);
              var srrIds = await exec(emrId, [listFrame], ['identity', cfg]);
              var srrIdentity = bestResult(srrIds, function (r) { return (r && r.name ? 20 : 0) + (r && r.dob ? 15 : 0) + (r && r.mrn ? 10 : 0) + ((r && r.score) || 0); }).result || {};
              var srrGate = visitIdentityGate(frozenHint, srrIdentity);
              if (!srrGate.ok) { attempt = { failure: { reason: 'identity-changed-after-surface-recycle' } }; break; }
              var srrEnR = await exec(emrId, [listFrame], ['enumerate', enumCfg]);
              var srrEn = bestResult(srrEnR, function (r) { return (r && r.ok && r.indexComplete === true) ? ((r.selector === 'li.encounter-list-item' ? 100000 : 0) + (r.score || 0)) : 0; }).result || null;
              var srrRows = (srrEn && srrEn.ok && srrEn.indexComplete === true) ? (srrEn.rows || []) : null;
              var srrKeyOk = false;
              if (srrRows && srrRows.length === total) {
                srrKeyOk = true;
                for (var srrK = 0; srrK < total; srrK++) {
                  var srrOldKey = rows[srrK] && rows[srrK].binding && rows[srrK].binding.rowKey;
                  var srrHas = false;
                  for (var srrJ = 0; srrJ < srrRows.length; srrJ++) { var srrNb = srrRows[srrJ] && srrRows[srrJ].binding; if (srrNb && srrNb.rowKey === srrOldKey) { srrHas = true; break; } }
                  if (!srrOldKey || !srrHas) { srrKeyOk = false; break; }
                }
              }
              if (!srrKeyOk) { attempt = { failure: { reason: 'row-set-changed-after-surface-recycle' } }; break; }
              listDocId = srrDocNow;
            }
          }
`;
s = s.slice(0, cAfter) + recycle + s.slice(cAfter);

/* ---- D. receipt fields ---- */
const D = 'attempted: attemptedCount, failures: failures.length, cap: cfg.maxVisits, retryCount: retryCount,';
must(D, 'D-receipt');
s = s.split(D).join(D + ' surfaceResets: surfaceResets, surfaceResetOps: surfaceResetOps.slice(0, 6),');

/* ---- E. shadow-aware ctrls in mlsEnsureClinicalChartFn ---- */
const E = "    var ctrls = [].slice.call(document.querySelectorAll('button,a,[role=button],[role=link],[role=tab],input[type=button],input[type=submit]')).slice(0, 900);";
must(E, 'E-ctrls');
const shadowCtrls =
`    var ctrls = (function () {
      /* srr-1.0 (3.0.50): the ax-variant briefing (athenaOne's CLINCMP rollout)
         renders its navigation inside shadow roots, so a light-DOM query finds
         NOTHING safe to click and the read dies exam-prep-stuck after five idle
         rounds (live 2026-08-08). Same selector, same BAD-verb filter, same
         visibility test - only the COLLECTION now descends open shadow roots
         (two levels, bounded). */
      var sel = 'button,a,[role=button],[role=link],[role=tab],input[type=button],input[type=submit]';
      var acc = [].slice.call(document.querySelectorAll(sel));
      try {
        var hosts = document.querySelectorAll('*');
        var walked = 0;
        for (var hi = 0; hi < hosts.length && walked < 60 && acc.length < 900; hi++) {
          var sr = hosts[hi].shadowRoot;
          if (!sr) continue;
          walked++;
          acc = acc.concat([].slice.call(sr.querySelectorAll(sel)));
          var inner = sr.querySelectorAll('*');
          for (var hj = 0; hj < inner.length && walked < 60 && acc.length < 900; hj++) {
            var sr2 = inner[hj].shadowRoot;
            if (sr2) { walked++; acc = acc.concat([].slice.call(sr2.querySelectorAll(sel))); }
          }
        }
      } catch (eShadowCtl) {}
      return acc.slice(0, 900);
    })();`;
s = s.split(E).join(shadowCtrls);

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED ok bytes ' + before + ' -> ' + s.length);
