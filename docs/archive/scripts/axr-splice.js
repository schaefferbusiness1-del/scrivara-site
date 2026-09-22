/* axr-1.0 (3.0.52) - the CLINCMP/ax-native encounter reader. Latin1, all-or-nothing.
 * Three injected ops (axHarvest / axGo / axRead) + the engine route path that fires
 * ONLY when the classic walk starved (no-chart-frame-candidate) - an identity
 * MISMATCH refusal never triggers it (fail-closed outranks coverage). */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}

/* ---- A. the three ops join the injected family (before the diagnose op) ---- */
const A = "    if (op === 'diagnose') { return diagnose(); }";
must(A, 'A-op-family');
const ops =
`    if (op === 'axHarvest') {
      /* axr-1.0: the CLINCMP/ax surface carries encounter ids IN anchor hrefs -
         no clicking, no accordion, no recycle window between click and read.
         Shadow-aware collection (the srr-1.2 walk shape); PHI-free surfaceSig
         travels with every answer so the reader is its own census. */
      var axAcc = [], axNodes = 0, axTids = {}, axShadowN = 0;
      (function axWalk(root, depth) {
        if (depth > 20 || axNodes > 12000) return;
        var all = root.querySelectorAll('*');
        for (var ai = 0; ai < all.length; ai++) {
          var el = all[ai]; axNodes++;
          if (el.shadowRoot) { axShadowN++; axWalk(el.shadowRoot, depth + 1); }
          if (el.tagName === 'A') {
            var ah = String(el.getAttribute('href') || '');
            var am = ah.match(/\\/(\\d+)\\/\\d+\\/ax\\/encounter\\/(\\d+)\\/(\\w+)/);
            if (am && axAcc.length < 80) axAcc.push({ eid: am[2], route: am[3], hrefPath: ah.replace(/[#?].*$/, '') });
          }
          var at = el.getAttribute && el.getAttribute('data-testid');
          if (at) axTids[String(at).replace(/\\d{3,}/g, 'N').slice(0, 30)] = 1;
        }
      })(document, 0);
      var axSeenEid = {}, axUnique = [];
      for (var au = 0; au < axAcc.length; au++) { if (!axSeenEid[axAcc[au].eid]) { axSeenEid[axAcc[au].eid] = 1; axUnique.push(axAcc[au]); } }
      return { ok: true, encounters: axUnique, surfaceSig: { route: String(location.pathname || '').replace(/\\d{4,}/g, 'N').slice(0, 60), testids: Object.keys(axTids).sort().slice(0, 20), shadowN: axShadowN, nodes: axNodes } };
    }
    if (op === 'axGo') {
      /* Engine-owned navigation of THIS frame to an encounter summary route.
         Same-origin relative path only - a full URL or foreign origin refuses.
         The href rides the driver's third positional (idx) - the fn signature
         is (op, cfg, idx, expectedBinding). */
      var gHref = String(idx || '');
      if (!/^\\/\\d+\\/\\d+\\/ax\\/encounter\\/\\d+\\/\\w+$/.test(gHref)) return { ok: false, reason: 'ax-nav-href-rejected' };
      try { location.assign(gHref); return { ok: true }; } catch (eGo) { return { ok: false, reason: 'ax-nav-failed' }; }
    }
    if (op === 'axRead') {
      /* Visibility-aware body capture (hc-1.0 discipline) + shadow-root text merge. */
      var axParts = [];
      try {
        if (document.visibilityState === 'visible') axParts.push(String((document.body && document.body.innerText) || ''));
        else {
          var axCl = document.body ? document.body.cloneNode(true) : null;
          if (axCl) { var axJ = axCl.querySelectorAll('script,style,noscript,template,svg,iframe'); for (var aji = 0; aji < axJ.length; aji++) { try { axJ[aji].parentNode.removeChild(axJ[aji]); } catch (eAj) {} } axParts.push(String(axCl.textContent || '').replace(/[ \\t]+/g, ' ')); }
        }
      } catch (eAxB) {}
      var axSN = 0;
      (function axTxtWalk(root, depth) {
        if (depth > 20 || axSN > 40) return;
        var all = root.querySelectorAll('*');
        for (var ti = 0; ti < all.length; ti++) { if (all[ti].shadowRoot) { axSN++; axParts.push(String(all[ti].shadowRoot.textContent || '').replace(/[ \\t]+/g, ' ')); axTxtWalk(all[ti].shadowRoot, depth + 1); } }
      })(document, 0);
      var axRaw = axParts.join('\\n').slice(0, 90000);
      var axDm = axRaw.match(/\\b(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4})\\b/);
      return { ok: axRaw.length > 0, raw: axRaw, headerDate: axDm ? axDm[1] : '', len: axRaw.length };
    }
${A}`;
s = s.slice(0, s.indexOf(A)) + ops.slice(0, ops.length - A.length) + s.slice(s.indexOf(A));

/* ---- B. the engine route path, gated to the STARVED-walk case only ---- */
const B = `      if (!gate.ok) {
        return {
          ok: false, reason: gate.reason, identity: identity, visits: [], diag: diag,`;
must(B, 'B-engine-hook');
const route =
`      /* axr-1.0: when the classic walk STARVED (no usable frame candidate) - and
         ONLY then; an identity-mismatch refusal is the product working and never
         triggers an alternate route - try the ax-native path: harvest encounter
         ids from hrefs, navigate the harvest frame per encounter, verify the
         SAME visitIdentityGate on each loaded summary, read, fail closed per
         encounter. Unknown identity shapes refuse as 'ax-identity-shape-unknown'
         WITH the observed signature (the reader is its own census; a refusal
         teaches the next probe shape - a guess could read the wrong patient). */
      if (!gate.ok && /^no-chart-frame-candidate/.test(String(gate.reason || '')) && Date.now() + 15000 < readDeadline) {
        var axHR = await exec(emrId, null, ['axHarvest', cfg]);
        var axBest = null, axBestFrame = -1;
        ((axHR || [])).forEach(function (hr) {
          var r0 = hr && hr.result;
          if (r0 && r0.ok && r0.encounters && r0.encounters.length && (!axBest || r0.encounters.length > axBest.encounters.length)) { axBest = r0; axBestFrame = hr.frameId; }
        });
        if (axBest && Number.isFinite(axBestFrame)) {
          var axVisits = [], axRefused = 0, axShapeUnknown = 0, axSigs = [axBest.surfaceSig], axT0 = Date.now();
          var axCap = Math.min(axBest.encounters.length, Number(cfg.maxVisits) || 40);
          for (var axI = 0; axI < axCap; axI++) {
            if (Date.now() + 6000 >= readDeadline) break;
            var axE = axBest.encounters[axI];
            var axNav = await exec(emrId, [axBestFrame], ['axGo', cfg, axE.hrefPath]);
            var axNavOk = bestResult(axNav, function (r) { return r && r.ok === true ? 1 : 0; }).result;
            if (!axNavOk || axNavOk.ok !== true) { axRefused++; continue; }
            await sleep(1800);
            touchVisitLease();
            var axIdOk = false, axIdent = null;
            var axIdDeadline = Math.min(readDeadline, Date.now() + 5200);
            do {
              var axIds = await exec(emrId, [axBestFrame], ['identity', cfg]);
              axIdent = bestResult(axIds, function (r) { return (r && r.name ? 20 : 0) + (r && r.dob ? 15 : 0) + (r && r.mrn ? 10 : 0) + ((r && r.score) || 0); }).result || null;
              if (axIdent && visitIdentityGate(frozenHint, axIdent).ok) { axIdOk = true; break; }
              await sleep(700);
            } while (Date.now() < axIdDeadline);
            if (!axIdOk) {
              if (axIdent && (axIdent.name || axIdent.dob)) axRefused++; /* identity SEEN and mismatched - hard refusal */
              else { axShapeUnknown++; /* identity never found - the census case, own named class */
                var axSigR = await exec(emrId, [axBestFrame], ['axHarvest', cfg]);
                var axSig0 = bestResult(axSigR, function (r) { return r && r.ok ? 1 : 0; }).result;
                if (axSig0 && axSigs.length < 6) axSigs.push(axSig0.surfaceSig);
              }
              continue;
            }
            var axRd = await exec(emrId, [axBestFrame], ['axRead', cfg]);
            var axBody = bestResult(axRd, function (r) { return (r && r.ok && r.raw) ? r.raw.length : 0; }).result;
            if (!axBody || !axBody.ok) { axRefused++; continue; }
            axVisits.push({ date: axBody.headerDate || '', type: 'ax encounter', raw: axBody.raw, cpt: [], icd10: [], source: 'athena-copy', patientName: (axIdent && axIdent.name) || '', patientDob: (axIdent && axIdent.dob) || '', patientMrn: (axIdent && axIdent.mrn) || '', binding: { rowKey: 'enc:' + axE.eid, encounterId: axE.eid, index: axI } });
          }
          if (axVisits.length) {
            var axKept = axVisits.length, axTotalE = axBest.encounters.length;
            return {
              ok: true, reason: '', identity: (axVisits[0] ? { name: axVisits[0].patientName, dob: axVisits[0].patientDob, mrn: axVisits[0].patientMrn } : identity), visits: axVisits, diag: diag,
              receipt: { complete: axKept === axTotalE && axRefused === 0 && axShapeUnknown === 0, indexComplete: true, bodyComplete: axKept === axTotalE, fullDetail: axKept === axTotalE, expected: axTotalE, parsed: axKept, attempted: axCap, failures: axRefused + axShapeUnknown, cap: cfg.maxVisits, retryCount: 0, surfaceResets: 0, surfaceResetOps: [], chartSurface: 'clincmp-ax-route', axEncounters: axTotalE, axRefused: axRefused, axShapeUnknown: axShapeUnknown, axSigs: axSigs.slice(0, 6), axRouteMs: Date.now() - axT0, identityVerified: true, stableKeysComplete: true, timeBudgetMs: readBudgetMs, elapsedMs: Math.max(0, Date.now() - readStartedAt) },
              error: axKept === axTotalE ? '' : ('The ax route read ' + axKept + ' of ' + axTotalE + ' encounters; ' + axRefused + ' refused (identity mismatch or read failure), ' + axShapeUnknown + ' refused as ax-identity-shape-unknown - signatures captured for the next probe shapes.')
            };
          }
          if (axShapeUnknown || axRefused) {
            gate = { ok: false, reason: 'ax-identity-shape-unknown[' + axShapeUnknown + ' unknown, ' + axRefused + ' refused of ' + axBest.encounters.length + ']' };
            try { diag = diag || {}; diag.axSigs = axSigs.slice(0, 6); } catch (eAxD) {}
          }
        }
      }
${B}`;
s = s.slice(0, s.indexOf(B)) + route.slice(0, route.length - B.length) + s.slice(s.indexOf(B));

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED axr-1.0 bytes ' + before + ' -> ' + s.length);
