#!/usr/bin/env node
'use strict';
/* scensus-1.0.1 latin1 index-splice for background.js (the only lawful
 * editor for this mixed-EOL file). Codex blocker 2 on 10f41d2d: the scoped
 * census future-day classification must never infer "today" from the machine
 * clock - around midnight, DST, or a remote clinic timezone the host date is
 * wrong and can falsely skip a note or misclassify a real day. The hint now
 * carries the canonical ACCOUNT-LOCAL day from the app; when it is absent
 * the scoped census fails PARTIAL: it still reads every row, but it can
 * never claim absence or not-yet-available without a calendar authority.
 *
 * EOL law learned from blocker 3: each target is matched in LF form first,
 * then CRLF form; the replacement inherits the EOL convention of whichever
 * form matched. Every target must occur exactly once or the script refuses
 * and writes nothing. */
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

/* ---- 1. freezeVisitHint carries the account-local day (validated) ---- */
splice('freezeVisitHint todayKey',
`      mrn: String(hint.mrn || hint.athenaId || '').trim(), onlyDate: mlsVisitDateKeyForHint(hint.onlyDate)
    };`,
`      mrn: String(hint.mrn || hint.athenaId || '').trim(), onlyDate: mlsVisitDateKeyForHint(hint.onlyDate),
      todayKey: /^\\d{4}-\\d{2}-\\d{2}$/.test(String(hint.todayKey || '')) ? String(hint.todayKey) : ''
    };`);

/* ---- 2+3. the two mid-walk re-freezes must not drop the authority ---- */
splice('re-freeze alias keeps todayKey',
`              frozenHint = Object.freeze({ name: frozenHint.name, dob: frozenHint.dob, mrn: frozenHint.mrn, onlyDate: frozenHint.onlyDate || '', nameAlias: String(pgIdentity.name) });`,
`              frozenHint = Object.freeze({ name: frozenHint.name, dob: frozenHint.dob, mrn: frozenHint.mrn, onlyDate: frozenHint.onlyDate || '', todayKey: frozenHint.todayKey || '', nameAlias: String(pgIdentity.name) });`);
splice('re-freeze identity keeps todayKey',
`              frozenHint = Object.freeze({ name: String(pgIdentity.name || ''), dob: String(pgIdentity.dob || ''), mrn: String(pgIdentity.mrn || ''), onlyDate: frozenHint.onlyDate || '', nameAlias: '' });`,
`              frozenHint = Object.freeze({ name: String(pgIdentity.name || ''), dob: String(pgIdentity.dob || ''), mrn: String(pgIdentity.mrn || ''), onlyDate: frozenHint.onlyDate || '', todayKey: frozenHint.todayKey || '', nameAlias: '' });`);

/* ---- 4. the future-day check reads the ACCOUNT calendar, never the host ---- */
splice('future check uses account todayKey',
`      /* scensus-1.0.0: a FUTURE scoped day cannot have an encounter note yet.
         Answer it as a bounded, complete not-yet-available baseline - zero
         rows opened, no prior encounter ever substituted. */
      if (frozenHint.onlyDate) {
        var scTodayD = new Date();
        var scTodayKey = scTodayD.getFullYear() + '-' + ('0' + (scTodayD.getMonth() + 1)).slice(-2) + '-' + ('0' + scTodayD.getDate()).slice(-2);
        if (frozenHint.onlyDate > scTodayKey) {`,
`      /* scensus-1.0.0: a FUTURE scoped day cannot have an encounter note yet.
         Answer it as a bounded, complete not-yet-available baseline - zero
         rows opened, no prior encounter ever substituted.
         scensus-1.0.1: "today" is the ACCOUNT-LOCAL day carried on the hint,
         never the machine clock. Without it the future classification does
         not run and the scoped census fails PARTIAL below. */
      var scTodayKey = String((frozenHint && frozenHint.todayKey) || '');
      var scTodayKeyValid = /^\\d{4}-\\d{2}-\\d{2}$/.test(scTodayKey);
      if (frozenHint.onlyDate) {
        if (scTodayKeyValid && frozenHint.onlyDate > scTodayKey) {`);

/* ---- 5. no absence claim without a calendar authority ---- */
splice('bodyComplete needs temporal authority',
`      var bodyComplete = failures.length === 0 && visits.length === clinicalTotal && stableKeysComplete && (!frozenHint.onlyDate || dateUnknownRows.length === 0);`,
`      var bodyComplete = failures.length === 0 && visits.length === clinicalTotal && stableKeysComplete && (!frozenHint.onlyDate || (dateUnknownRows.length === 0 && scTodayKeyValid));`);

/* ---- 6. the verdict ladder degrades to partial without the authority ---- */
splice('ladder partial without authority',
`        if (visits.length > 0) scSameDay = 'saved';
        else if (dateUnknownRows.length > 0) scSameDay = 'partial';`,
`        if (visits.length > 0) scSameDay = 'saved';
        else if (!scTodayKeyValid) scSameDay = 'partial'; /* no calendar authority - absence is unprovable */
        else if (dateUnknownRows.length > 0) scSameDay = 'partial';`);

/* ---- 7. the receipt names its temporal authority ---- */
splice('receipt temporalAuthority',
`dateUnknownRows: dateUnknownRows.length, onlyDate: (frozenHint && frozenHint.onlyDate) || '', scopeDate: scScoped ? frozenHint.onlyDate : '', sameDayStatus: scScoped ? scSameDay : undefined,`,
`dateUnknownRows: dateUnknownRows.length, onlyDate: (frozenHint && frozenHint.onlyDate) || '', scopeDate: scScoped ? frozenHint.onlyDate : '', temporalAuthority: scScoped ? (scTodayKeyValid ? 'account-local' : 'absent') : undefined, sameDayStatus: scScoped ? scSameDay : undefined,`);

fs.writeFileSync(file, t, 'latin1');
console.log('background.js spliced; bytes now', t.length);
