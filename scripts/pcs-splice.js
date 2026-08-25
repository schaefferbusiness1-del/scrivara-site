#!/usr/bin/env node
'use strict';
/* pcs-1.0.0 latin1 index-splice for background.js. Systemic slice item 1+2
 * (Codex 0/8 audit): the AllVisits tab picker records a PHI-free PICK CENSUS
 * on every resolution - held lease, lease reachability, candidate count,
 * exact-identity matches, selection source, and a CLOSED failure code - and
 * the no-athena-tab refusal carries that census instead of flattening every
 * cause into one English string. Codes are machine classification; English
 * remains display-only. EOL-aware; unique targets; refuses and writes
 * nothing on any miss. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'background.js');
let t = fs.readFileSync(file, 'latin1');

function splice(label, oldStr, newStr) {
  for (const eol of ['\n', '\r\n']) {
    const o = oldStr.replace(/\n/g, eol);
    const first = t.indexOf(o);
    if (first < 0) continue;
    if (t.indexOf(o, first + 1) >= 0) throw new Error(label + ': target not unique');
    t = t.slice(0, first) + newStr.replace(/\n/g, eol) + t.slice(first + o.length);
    console.log('spliced', label, eol === '\n' ? '(LF)' : '(CRLF)');
    return;
  }
  throw new Error(label + ': target not found in either EOL form');
}

/* ---- 1. census object, published from the first instruction ---- */
splice('census init',
`  function pickEmrTab(hint) {
    try { self.__mlsLastVisitPickFailure = null; } catch (ePickState) {}`,
`  function pickEmrTab(hint) {
    try { self.__mlsLastVisitPickFailure = null; } catch (ePickState) {}
    /* pcs-1.0.0: one PHI-free census per pick - counts, codes, and the
       selection source. Published immediately so even a hard throw leaves
       the census of what WAS seen. */
    var pickDiag = { at: Date.now(), candidateCount: 0, leaseHeld: false, leaseTabId: 0, leaseReachable: null, leaseSleeping: false, exactMatches: 0, selectionSource: '', code: '' };
    try { self.__mlsLastVisitPickDiag = pickDiag; } catch (ePcsPub) {}`);

/* ---- 2. candidate count ---- */
splice('candidate count',
`          var cand = (tabs || []).filter(function (t) { return t.url && EMR_RE.test(t.url); });
          cand.sort(function (a, b) { return (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.id - a.id); });`,
`          var cand = (tabs || []).filter(function (t) { return t.url && EMR_RE.test(t.url); });
          cand.sort(function (a, b) { return (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.id - a.id); });
          pickDiag.candidateCount = cand.length;
          if (!cand.length) pickDiag.code = 'no-candidates';`);

/* ---- 3. lease branch: held / sleeping / gone / served ---- */
splice('lease held stamp',
`            if (leaseMatches) {
              var exact = cand.find(function (t) { return Number(t.id) === Number(lease.tabId); });`,
`            if (leaseMatches) {
              pickDiag.leaseHeld = true; pickDiag.leaseTabId = Number(lease.tabId) || 0;
              var exact = cand.find(function (t) { return Number(t.id) === Number(lease.tabId); });
              pickDiag.leaseReachable = !!exact;
              if (!exact) pickDiag.code = 'lease-tab-gone';`);

splice('lease sleeping stamp',
`              if (exact && typeof mlsAthTabSleeping === 'function' && mlsAthTabSleeping(exact)) {
                try { self.__mlsLastVisitPickFailure = { reason: 'athena-tab-sleeping', signedOut: false, tabId: exact.id }; } catch (eSleepLease) {}
                resolve(null); return;
              }
              resolve(exact || null); return;`,
`              if (exact && typeof mlsAthTabSleeping === 'function' && mlsAthTabSleeping(exact)) {
                pickDiag.leaseSleeping = true; pickDiag.code = 'lease-sleeping';
                try { self.__mlsLastVisitPickFailure = { reason: 'athena-tab-sleeping', signedOut: false, tabId: exact.id }; } catch (eSleepLease) {}
                resolve(null); return;
              }
              if (exact) { pickDiag.selectionSource = 'lease'; }
              resolve(exact || null); return;`);

/* ---- 4. identity scan verdicts ---- */
splice('identity scan stamps',
`                if (exactMatches.length) { resolve(exactMatches[0]); return; }
                resolve(null);`,
`                pickDiag.exactMatches = exactMatches.length;
                if (exactMatches.length) { pickDiag.selectionSource = 'identity-proven'; resolve(exactMatches[0]); return; }
                pickDiag.code = 'identity-not-proven';
                resolve(null);`);

/* ---- 5. the legacy fallback pick declares itself ---- */
splice('fallback stamp',
`          } catch (e2) {}
          resolve(cand[0] || null);`,
`          } catch (e2) {}
          if (cand[0]) pickDiag.selectionSource = pickDiag.selectionSource || 'fallback-first';
          resolve(cand[0] || null);`);

/* ---- 6. the refusal carries the census + a closed code ---- */
splice('refusal carries census',
`        return Date.now() >= readDeadline ? deadlineResult('exact-tab selection') : { ok: false, reason: 'no-athena-tab', visits: [], error: 'No exact-patient athenaOne chart or fresh verified chart lease was proved.`,
`        var pcsD = null, pcsCode = '';
        try { pcsD = self.__mlsLastVisitPickDiag || null; pcsCode = String((pcsD && pcsD.code) || (self.__mlsLastVisitPickFailure && self.__mlsLastVisitPickFailure.reason) || 'no-athena-tab'); } catch (ePcsRead) {}
        return Date.now() >= readDeadline ? deadlineResult('exact-tab selection') : { ok: false, reason: 'no-athena-tab', code: pcsCode, pickDiag: pcsD, visits: [], error: 'No exact-patient athenaOne chart or fresh verified chart lease was proved.`);

fs.writeFileSync(file, t, 'latin1');
console.log('background.js spliced; bytes now', t.length);
