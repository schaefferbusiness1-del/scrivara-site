'use strict';
/* het-1.0.2 — the per-gate census keeps the FURTHEST attempt, not the last.
 *
 * het-1.0.1 live read {metaCount: 0, qualified: false} because EVERY
 * identity-less frame runs the qualifier and the last one (an empty
 * side-panel iframe with zero metas) overwrote the encounter frame's counts.
 * Each attempt now carries a rank (0 none -> 1 meta -> 2 patient -> 3 appt ->
 * 4 provider -> 5 date -> 6 qualified) and commits to the shared census only
 * when it got at least as far as the best attempt so far. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

const START = "    var hetDiag = { metaCount: -1, metaPatientMatch: null, apptCount: -1, provCount: -1, dateCount: -1, qualified: false, ancestorIdentity: '', noteTargetFound: null };";
const END = "    function encounterMetadataFor(frame, actionRoot, identityRoot) {";
const s0 = src.indexOf(START);
const e0 = src.indexOf(END);
if (s0 < 0 || e0 < 0 || e0 < s0) throw new Error('het102: span not found');

const NEW = "    var hetDiag = { rank: -1, metaCount: -1, metaPatientMatch: null, apptCount: -1, provCount: -1, dateCount: -1, qualified: false, ancestorIdentity: '', noteTargetFound: null };\n" +
"    function hetStageEncounterContext(frame, expectedPatient) {\n" +
"      /* het-1.0.0/1.0.2: athena's own machine-typed encounter context, read\n" +
"         off an athenaClinicals stage frame. Every field must resolve to\n" +
"         EXACTLY ONE distinct value or the frame does not qualify. The\n" +
"         attempt census keeps the FURTHEST-progressing frame (rank), so an\n" +
"         empty side panel cannot overwrite the encounter frame's counts.\n" +
"         Values are compared, never logged. */\n" +
"      var att = { rank: 0, metaCount: -1, metaPatientMatch: null, apptCount: -1, provCount: -1, dateCount: -1, qualified: false };\n" +
"      function hetCommit() { if (att.rank >= Number(hetDiag.rank || 0)) { hetDiag.rank = att.rank; hetDiag.metaCount = att.metaCount; hetDiag.metaPatientMatch = att.metaPatientMatch; hetDiag.apptCount = att.apptCount; hetDiag.provCount = att.provCount; hetDiag.dateCount = att.dateCount; hetDiag.qualified = att.qualified; } }\n" +
"      try {\n" +
"        var metas = deepQueryAll(frame.doc, 'meta').filter(function (m) { return /encounter_id/.test(m.getAttribute('content') || ''); });\n" +
"        att.metaCount = metas.length;\n" +
"        if (metas.length !== 1) { hetCommit(); return null; }\n" +
"        att.rank = 1;\n" +
"        var arr = JSON.parse(metas[0].getAttribute('content'));\n" +
"        if (!Array.isArray(arr)) { hetCommit(); return null; }\n" +
"        var ctx = {};\n" +
"        for (var ai = 0; ai < arr.length; ai++) { var it = arr[ai]; if (it && typeof it === 'object') { for (var ck in it) { if (Object.prototype.hasOwnProperty.call(it, ck)) ctx[ck] = String(it[ck]); } } }\n" +
"        var encId = digits(ctx.encounter_id || ''), metaPatient = digits(ctx.patient_id || '');\n" +
"        var wantMrn = digits(expectedPatient.mrn);\n" +
"        att.metaPatientMatch = !!(metaPatient && wantMrn && metaPatient === wantMrn);\n" +
"        if (!encId || encId.length < 3 || !metaPatient || !wantMrn || metaPatient !== wantMrn) { hetCommit(); return null; }\n" +
"        att.rank = 2;\n" +
"        var html = '';\n" +
"        try { html = String(frame.doc.body ? frame.doc.body.innerHTML : ''); } catch (eHtml) { hetCommit(); return null; }\n" +
"        if (html.length > 6000000) html = html.slice(0, 6000000);\n" +
"        function hetUniq(re, mapFn) {\n" +
"          var seen = {}, out = [], m2;\n" +
"          while ((m2 = re.exec(html))) { var v = mapFn ? mapFn(m2[1]) : m2[1]; if (v && !seen[v]) { seen[v] = 1; out.push(v); if (out.length > 3) break; } }\n" +
"          return out;\n" +
"        }\n" +
"        var appts = hetUniq(/\"AppointmentID\\\\?\"\\s*:\\s*\\\\?\"(\\d{3,})/g);\n" +
"        att.apptCount = appts.length;\n" +
"        if (appts.length !== 1) { hetCommit(); return null; }\n" +
"        att.rank = 3;\n" +
"        var provs = hetUniq(/\"DisplayName\\\\?\"\\s*:\\s*\\\\?\"([^\"\\\\]{4,70})\\\\?\"/g, function (v) { return /,\\s*(?:MD|DO|PA-C|CRNP|NP|DPM)\\s*$/.test(v) ? v : ''; });\n" +
"        att.provCount = provs.length;\n" +
"        if (provs.length !== 1) { hetCommit(); return null; }\n" +
"        att.rank = 4;\n" +
"        var dates = hetUniq(/\"(?:Scheduled|Appointment|Service|Visit|Appt)[A-Za-z]*Date\\\\?\"[^0-9]{0,80}?(\\d{4}-\\d{2}-\\d{2})/g);\n" +
"        att.dateCount = dates.length;\n" +
"        if (dates.length !== 1) { hetCommit(); return null; }\n" +
"        att.rank = 5;\n" +
"        var visitDate = dateKey(dates[0]);\n" +
"        if (!visitDate) { hetCommit(); return null; }\n" +
"        att.rank = 6; att.qualified = true; hetCommit();\n" +
"        return { encounterId: encId, appointmentId: digits(appts[0]), provider: text(provs[0]), visitDate: visitDate };\n" +
"      } catch (eHet) { hetCommit(); return null; }\n" +
"    }\n";

src = src.slice(0, s0) + NEW + src.slice(e0);
fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.2 spliced OK');
