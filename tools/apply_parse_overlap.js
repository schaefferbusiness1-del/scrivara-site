/* si-1.8.0 (b375): bodies-ON pulls overlap the parse+persist chain with the
 * SAME patient's visits read. The parse touches only the parse server and the
 * local store - never the screen - while the visits reader needs the chart
 * visible. The parse is awaited BEFORE saveVerifiedVisits (its organization
 * proof reads what the parse persisted). A failed overlapped parse gets one
 * bounded sequential re-run, then the same honest receipt as the inline path.
 * Measured basis: si-1.7.3 stamps showed ~16s/patient parseSave while the
 * Athena tab sat idle. File is pure-LF; plain node edits. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'feat_mls_schedimport_exact.js');
let src = fs.readFileSync(FILE, 'utf8');
function replaceOnce(oldStr, newStr, label) {
  const i = src.indexOf(oldStr);
  if (i < 0) throw new Error('anchor missing: ' + label);
  if (src.indexOf(oldStr, i + 1) >= 0) throw new Error('anchor not unique: ' + label);
  src = src.slice(0, i) + newStr + src.slice(i + oldStr.length);
}

/* 1. comment truth update */
replaceOnce(
"       With full visit bodies ON the batch stays strictly sequential (the\n       visits reader needs THIS patient's chart on screen). */",
"       si-1.8.0: with full visit bodies ON, the parse now overlaps the SAME\n       patient's visits read instead (the parse never needs the screen) and is\n       awaited before saveVerifiedVisits, whose history-organization proof\n       reads what the parse persisted. */",
'comment');

/* 2. per-patient overlap holder */
replaceOnce(
'        var stageMs = { chart: 0, parseSave: 0, visits: 0, visitSave: 0 };\n        var rd = null, chartAttempt = 0;',
'        var stageMs = { chart: 0, parseSave: 0, visits: 0, visitSave: 0 };\n        var rd = null, chartAttempt = 0, overlapParse = null;',
'holder');

/* 3. bodies-ON: launch parse without awaiting */
replaceOnce(
"            __parseT0 = Date.now();\n            var organizedResult = await saveOrganizedHistory(target, row, rd, chartReadStartedAt, parseDeadlineAt, parseRequestId);\n            stageMs.parseSave += Date.now() - __parseT0;\n            __parseT0 = 0;\n            one.chartCoverage = organizedResult.chartCoverage; one.profileCoverage=organizedResult.profileCoverage; one.clinicalFieldCount=organizedResult.clinicalFieldCount; one.dobVerified=organizedResult.dobVerified===true;\n            one.organized = !!(one.profileCoverage&&one.profileCoverage.complete===true);\n            one.chartReason = \"\";\n            break;",
"            /* si-1.8.0: launch the parse+persist chain now and let it run\n               while the visits stage below reads THIS chart. It is awaited in\n               collectOverlapParse before saveVerifiedVisits. */\n            overlapParse = { t0: Date.now(), args: { target: target, row: row, rd: rd, readStartedAt: chartReadStartedAt, deadlineAt: parseDeadlineAt, requestId: parseRequestId } };\n            overlapParse.settled = saveOrganizedHistory(target, row, rd, chartReadStartedAt, parseDeadlineAt, parseRequestId)\n              .then(function (r) { return { ok: true, r: r }; }, function (e) { return { ok: false, e: e }; });\n            break;",
'launch');

/* 4. collector helper, inserted before the patient loop */
replaceOnce(
'    try {\n      for (var i = 0; i < rows.length; i++) {',
"    async function collectOverlapParse(overlap, one, stageMs, patientDeadlineAt) {\n      /* Settle the overlapped parse; on a non-timeout failure give it ONE\n         bounded sequential re-run (same rd - the chart was verified when it\n         was read), then apply exactly what the inline path applied. */\n      if (!overlap) return;\n      var outcome = await overlap.settled;\n      stageMs.parseSave += Date.now() - overlap.t0;\n      if (!outcome.ok && !/timeout|deadline/i.test(String(outcome.e && outcome.e.message || \"\")) && Date.now() + 150000 < patientDeadlineAt + 300000) {\n        var __rpT0 = Date.now();\n        try {\n          var reParseDeadlineAt = Math.min(patientDeadlineAt, Date.now() + 120000);\n          outcome = { ok: true, r: await saveOrganizedHistory(overlap.args.target, overlap.args.row, overlap.args.rd, overlap.args.readStartedAt, reParseDeadlineAt, overlap.args.requestId + \"-r2\") };\n        } catch (reParseErr) { outcome = { ok: false, e: reParseErr }; }\n        stageMs.parseSave += Date.now() - __rpT0;\n      }\n      if (outcome.ok) {\n        var organizedResult = outcome.r;\n        one.chartCoverage = organizedResult.chartCoverage; one.profileCoverage = organizedResult.profileCoverage; one.clinicalFieldCount = organizedResult.clinicalFieldCount; one.dobVerified = organizedResult.dobVerified === true;\n        one.organized = !!(one.profileCoverage && one.profileCoverage.complete === true);\n        one.chartReason = \"\";\n      } else {\n        one.chartReason = String(outcome.e && outcome.e.message || outcome.e || \"chart-parse-failed\").slice(0, 120);\n        if (outcome.e && outcome.e.mlsEchoes) one.chartEchoes = outcome.e.mlsEchoes;\n      }\n    }\n    try {\n      for (var i = 0; i < rows.length; i++) {",
'collector');

/* 5. await the parse before the visit save (success path) */
replaceOnce(
'            var __visitSaveT0 = Date.now();\n            var savedVisits = saveVerifiedVisits(target, vr);',
'            await collectOverlapParse(overlapParse, one, stageMs, patientDeadlineAt); overlapParse = null;\n            var __visitSaveT0 = Date.now();\n            var savedVisits = saveVerifiedVisits(target, vr);',
'await before save');

/* 6. settle the parse on the visits-failure path too (no dangling promise) */
replaceOnce(
'          } catch (visitErr) { one.visitsReason = String(visitErr && visitErr.message || visitErr || "visits-read-failed").slice(0, 120); if (/timeout|deadline/i.test(one.visitsReason)) { stopAfterTimeout = true; receipt.timedOut = true; } }',
'          } catch (visitErr) { one.visitsReason = String(visitErr && visitErr.message || visitErr || "visits-read-failed").slice(0, 120); if (/timeout|deadline/i.test(one.visitsReason)) { stopAfterTimeout = true; receipt.timedOut = true; } }\n          if (overlapParse) { try { await collectOverlapParse(overlapParse, one, stageMs, patientDeadlineAt); } catch (eOverlapLate) {} overlapParse = null; }',
'settle on failure');

fs.writeFileSync(FILE, src);
console.log('OK si-1.8.0 parse overlap applied');
