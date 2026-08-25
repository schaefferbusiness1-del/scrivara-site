#!/usr/bin/env node
'use strict';
/* scensus-1.0.0 latin1 index-splice for background.js (the only lawful editor
 * for this mixed-EOL file). Same-day census semantics for the scoped
 * (onlyDate) AllVisits read, per Codex red contract same-day-reader-census:
 * unknown dates are never absence, a future day is not-yet-available, novel
 * row kinds stay clinical. Five exact-substring replacements; each must occur
 * exactly once or the splice refuses and writes nothing. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'background.js');
let t = fs.readFileSync(file, 'latin1');

function splice(label, oldStr, newStr) {
  oldStr = oldStr.replace(/\n/g, '\r\n');
  newStr = newStr.replace(/\n/g, '\r\n');
  const first = t.indexOf(oldStr);
  if (first < 0) throw new Error(label + ': target not found');
  if (t.indexOf(oldStr, first + 1) >= 0) throw new Error(label + ': target not unique');
  t = t.slice(0, first) + newStr + t.slice(first + oldStr.length);
  console.log('spliced', label);
}

/* ---- 1. declarations: the unknown-date census bucket ---- */
splice('declarations',
`      var visits = [], failures = [], retryCount = 0, minimalBodies = 0, attemptedCount = 0, administrativeRows = [], administrativeVisits = [], dateSkippedRows = [];`,
`      var visits = [], failures = [], retryCount = 0, minimalBodies = 0, attemptedCount = 0, administrativeRows = [], administrativeVisits = [], dateSkippedRows = [], dateUnknownRows = [];
      /* scensus-1.0.0: a FUTURE scoped day cannot have an encounter note yet.
         Answer it as a bounded, complete not-yet-available baseline - zero
         rows opened, no prior encounter ever substituted. */
      if (frozenHint.onlyDate) {
        var scTodayD = new Date();
        var scTodayKey = scTodayD.getFullYear() + '-' + ('0' + (scTodayD.getMonth() + 1)).slice(-2) + '-' + ('0' + scTodayD.getDate()).slice(-2);
        if (frozenHint.onlyDate > scTodayKey) {
          emit(appTabId, frozenRequestId, 'The requested day has not happened yet - no encounter note can exist; nothing was opened.', 0, total);
          return { ok: true, identity: identity, visits: [], administrativeVisits: [], diag: diag, strategy: 'bound-click', found: total,
            receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, expected: 0, parsed: 0,
              administrativeRows: 0, dateSkippedRows: 0, dateUnknownRows: 0, onlyDate: frozenHint.onlyDate, scopeDate: frozenHint.onlyDate,
              sameDayStatus: 'not-yet-available', notYetAvailable: true, noSubstitution: true, absenceProven: false, indexTotal: total,
              attempted: 0, failures: 0, cap: cfg.maxVisits, retryCount: 0, surfaceResets: 0, surfaceResetOps: [], chartSurface: chartSurface,
              timeBudgetMs: readBudgetMs, elapsedMs: Math.max(0, Date.now() - readStartedAt), identityVerified: gate.ok, stableKeysComplete: true,
              minimalBodies: 0, authoritativeEmpty: false } };
        }
      }`);

/* ---- 2. the scoped skip splits unknown-date from known-other-day ---- */
splice('scoped skip split',
`        if (frozenHint.onlyDate && mlsVisitDateKeyForHint(snap.date) !== frozenHint.onlyDate) { dateSkippedRows.push({ index: i, date: String(snap.date || '').slice(0, 20) }); emit(appTabId, frozenRequestId, 'Indexed encounter ' + (i + 1) + ' of ' + total + ' (outside the requested day - body not read).', i + 1, total); continue; } /* v3.0.30 scoped-day read: the fast lane captures the pulled day's own note and nothing else */`,
`        if (frozenHint.onlyDate) { /* scensus-1.0.0: an UNPARSEABLE date is UNKNOWN - it can neither prove nor disprove the requested day, so it makes the scoped census PARTIAL instead of silently shrinking it into absence-by-arithmetic. A known other-day row is honestly outside the scope. Neither is clicked on a scoped pass. */
          var scRowKey = mlsVisitDateKeyForHint(snap.date);
          if (!scRowKey) { dateUnknownRows.push({ index: i, type: String(snap.type || '').slice(0, 60) }); emit(appTabId, frozenRequestId, 'Indexed encounter ' + (i + 1) + ' of ' + total + ' (its date could not be read - counted as unknown, not as absent; body not read on this scoped pass).', i + 1, total); continue; }
          if (scRowKey !== frozenHint.onlyDate) { dateSkippedRows.push({ index: i, date: String(snap.date || '').slice(0, 20) }); emit(appTabId, frozenRequestId, 'Indexed encounter ' + (i + 1) + ' of ' + total + ' (outside the requested day - body not read).', i + 1, total); continue; }
        } /* v3.0.30 scoped-day read: the fast lane captures the pulled day's own note and nothing else */`);

/* ---- 3. clinicalTotal excludes the unknown bucket too ---- */
splice('clinicalTotal',
`      var clinicalTotal = Math.max(0, total - administrativeRows.length - dateSkippedRows.length);`,
`      var clinicalTotal = Math.max(0, total - administrativeRows.length - dateSkippedRows.length - dateUnknownRows.length);`);

/* ---- 4. completeness: an unknown date makes a SCOPED census incomplete ---- */
splice('bodyComplete',
`      var bodyComplete = failures.length === 0 && visits.length === clinicalTotal && stableKeysComplete;`,
`      var bodyComplete = failures.length === 0 && visits.length === clinicalTotal && stableKeysComplete && (!frozenHint.onlyDate || dateUnknownRows.length === 0);
      /* scensus-1.0.0: the scoped census verdict, from the counted buckets. */
      var scScoped = !!(frozenHint && frozenHint.onlyDate);
      var scSameDay = '';
      if (scScoped) {
        if (visits.length > 0) scSameDay = 'saved';
        else if (dateUnknownRows.length > 0) scSameDay = 'partial';
        else if (failures.length > 0) scSameDay = 'refused';
        else scSameDay = 'absent';
      }`);

/* ---- 5. receipt carries the census vocabulary ---- */
splice('receipt fields',
`        fullDetail: bodyComplete, expected: clinicalTotal, parsed: visits.length, administrativeRows: administrativeRows.length, dateSkippedRows: dateSkippedRows.length, onlyDate: (frozenHint && frozenHint.onlyDate) || '', indexTotal: total,`,
`        fullDetail: bodyComplete, expected: clinicalTotal, parsed: visits.length, administrativeRows: administrativeRows.length, dateSkippedRows: dateSkippedRows.length, dateUnknownRows: dateUnknownRows.length, onlyDate: (frozenHint && frozenHint.onlyDate) || '', scopeDate: scScoped ? frozenHint.onlyDate : '', sameDayStatus: scScoped ? scSameDay : undefined, absenceProven: scScoped ? (scSameDay === 'absent' && bodyComplete) : undefined, noSubstitution: scScoped ? true : undefined, indexTotal: total,`);

fs.writeFileSync(file, t, 'latin1');
console.log('background.js spliced; bytes now', t.length);
