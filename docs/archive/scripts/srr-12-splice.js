/* srr-1.2 (3.0.51) background splice - four edits, all-or-nothing, latin1.
 * A) chartSurface derived at index acceptance  B) receipt carries it
 * C) recycle identity re-poll before the fail-closed verdict (July-1 chart BS)
 * D) stm.esp OK-but-EMPTY frame re-expand before the noise drop (July-1 x5) */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}

/* ---- A. chartSurface beside the srr-1.0 epoch capture ---- */
const A = '      var listDocId = await visitsListFrameDocId(emrId, listFrame);';
must(A, 'A-epoch');
const surf =
`      /* srr-1.2: name the surface this chart was read on. The CLINCMP/ax
         rollout only moves one way; the receipt carries which UI answered so
         the trend is a number, not a mystery that reads as regression. */
      var chartSurface = '';
      try { chartSurface = /\\/ax\\/|briefing/i.test(String((identity && identity.url) || '')) ? 'clincmp-ax' : 'classic'; } catch (eSurf) { chartSurface = ''; }
`;
s = s.slice(0, s.indexOf(A)) + surf + s.slice(s.indexOf(A));

/* ---- B. receipt field ---- */
const B = 'retryCount: retryCount, surfaceResets: surfaceResets, surfaceResetOps: surfaceResetOps.slice(0, 6),';
must(B, 'B-receipt');
s = s.split(B).join(B + ' chartSurface: chartSurface,');

/* ---- C. recycle identity re-poll ---- */
const C = "              var srrIds = await exec(emrId, [listFrame], ['identity', cfg]);\n              var srrIdentity = bestResult(srrIds, function (r) { return (r && r.name ? 20 : 0) + (r && r.dob ? 15 : 0) + (r && r.mrn ? 10 : 0) + ((r && r.score) || 0); }).result || {};\n              var srrGate = visitIdentityGate(frozenHint, srrIdentity);";
const cAlt = C.replace(/\n/g, '\r\n');
let cAnchor = null;
if (s.split(C).length - 1 === 1) cAnchor = C;
else if (s.split(cAlt).length - 1 === 1) cAnchor = cAlt;
else { console.error('ANCHOR C not found in either EOL form'); process.exit(1); }
const rePoll =
`              var srrIdentity = {}, srrGate = { ok: false, reason: 'identity-not-read' };
              /* srr-1.2: July-1 live (chart BS) - a reborn document needs longer
                 than one settle to paint its banner, and a single-shot identity
                 read right after openVisits refused a legitimate replacement.
                 Re-poll briefly BEFORE the fail-closed verdict; the gate itself
                 is unchanged and still decides. */
              var srrIdDeadline = Math.min(readDeadline, Date.now() + 5200);
              do {
                var srrIds = await exec(emrId, [listFrame], ['identity', cfg]);
                srrIdentity = bestResult(srrIds, function (r) { return (r && r.name ? 20 : 0) + (r && r.dob ? 15 : 0) + (r && r.mrn ? 10 : 0) + ((r && r.score) || 0); }).result || {};
                srrGate = visitIdentityGate(frozenHint, srrIdentity);
                if (srrGate.ok) break;
                if (!(await sleepWithinReadDeadline(800))) break;
              } while (Date.now() < srrIdDeadline);`;
s = s.split(cAnchor).join(rePoll);

/* ---- D1. re-expand seen-set declaration ---- */
const D1 = "      var ecSeen = [], ecPicked = false, ecRelaxed = false, ecIdCache = {};";
must(D1, 'D1-decl');
s = s.split(D1).join(D1 + ' var __srrReExpanded = {};');

/* ---- D2. empty-frame re-expand before the noise drop ---- */
const D2 = "          if (ecNoise && !(ecGate && ecGate.ok)) ecDrop = 'noise-surface';";
must(D2, 'D2-noise-drop');
const reExpand =
`          /* srr-1.2 (3.0.51): July-1 live - FIVE charts died at this drop with
             the stm.esp candidate answering enumerate OK-but-EMPTY (0 rows, no
             identity rendered), so the 3.0.49 acceptance had nothing to prove.
             An empty variant frame is often just UNEXPANDED. Before dropping,
             drive openVisits INTO THIS FRAME once, settle, and re-read identity
             + enumerate. The gate itself is unchanged - identity still decides;
             this only gives the frame one chance to paint. Bounded once per
             frame per read. */
          if (ecNoise && !(ecGate && ecGate.ok) && ecCand && Number.isFinite(ecCand.frameId) &&
              ecCand.result && ecCand.result.ok === true && Number(ecCand.result.count || 0) === 0 &&
              !__srrReExpanded[String(ecCand.frameId)] && Date.now() + 6000 < readDeadline) {
            __srrReExpanded[String(ecCand.frameId)] = 1;
            await exec(emrId, [ecCand.frameId], ['openVisits', cfg]);
            await sleep(2500);
            touchVisitLease();
            var rxIds = await exec(emrId, [ecCand.frameId], ['identity', cfg]);
            var rxIdentity = bestResult(rxIds, function (r) { return (r && r.name ? 20 : 0) + (r && r.dob ? 15 : 0) + (r && r.mrn ? 10 : 0) + ((r && r.score) || 0); }).result || null;
            var rxEnR = await exec(emrId, [ecCand.frameId], ['enumerate', enumCfg]);
            var rxEn = bestResult(rxEnR, function (r) { return (r && r.ok) ? ((r.selector === 'li.encounter-list-item' ? 100000 : 0) + (r.score || 0)) : 0; }).result || null;
            if (rxIdentity) { ecIdCache[ecCand.frameId] = rxIds; ecIdentity = rxIdentity; ecGate = visitIdentityGate(frozenHint, rxIdentity); }
            if (rxEn && rxEn.ok && Number(rxEn.count || 0) > 0) ecCand.result = rxEn;
          }
          if (ecNoise && !(ecGate && ecGate.ok)) ecDrop = 'noise-surface';`;
s = s.split(D2).join(reExpand);

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED srr-1.2 bytes ' + before + ' -> ' + s.length);
