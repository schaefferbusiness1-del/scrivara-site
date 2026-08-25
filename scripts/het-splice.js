'use strict';
/* het-1.0.0 — the write driver qualifies athenaClinicals STAGE surfaces.
 *
 * Live 2026-08-25 (ext 3.0.81, practice 22724): the owner's encounter UI is the
 * athenaClinicals stage bar (Review|HPI|ROS|PE|A/P). On it the patient banner
 * and the note editor live in DIFFERENT frames, so the one-frame identity
 * anchor could never qualify a candidate and EVERY note write refused
 * "Could not identify one exact patient encounter frame" with the editor
 * sitting open (error report: errorClass no-encounter-frame, observedDay "").
 * Measured anatomy of the stage frame (top.f1.f2.f2):
 *   - athena's own machine-typed context META:
 *     [{"chart_id":..},{"department_id":..},{"encounter_id":"15991289"},
 *      {"encounter_username":..},{"patient_id":"7833832"},{"specialty_id":..}]
 *   - page config carries "AppointmentID":"55816420", provider
 *     "DisplayName":"Matthew Schaeffer, MD", and a labeled ScheduledDate
 *     "Date":"2026-08-25T…".
 *   - the note editor is the UTA slate component (uta_c_editor), present.
 *
 * The het path is STRICTER than the classic path, never looser:
 *   1. the frame must carry EXACTLY ONE encounter-context META whose
 *      patient_id equals the expected MRN;
 *   2. an ANCESTOR frame's banner (never a sibling) must pass the exact same
 *      name/DOB/MRN gates the classic path runs;
 *   3. appointment id, provider display name and labeled service date must
 *      each resolve to EXACTLY ONE distinct value in the frame's own
 *      serialization — two patients/encounters/providers/dates anywhere
 *      refuse instead of guessing;
 *   4. every downstream equality gate (expected encounterId, appointmentId,
 *      visitDate, provider) runs unchanged against the observed values.
 *
 * background.js law: latin1, index-splice, LF-first-then-CRLF matching, and
 * the inserted block normalized to the region's EOL flavor afterward.
 */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF.replace(/\n/g, '\r\n');
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('het-splice: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het-splice: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* ---- 1: the stage-context reader, beside encounterMetadataFor ---- */
const HELPER_ANCHOR = "    function encounterMetadataFor(frame, actionRoot, identityRoot) {";
const HELPER = "    function hetStageEncounterContext(frame, expectedPatient) {\n" +
"      /* het-1.0.0: athena's own machine-typed encounter context, read off an\n" +
"         athenaClinicals stage frame. Every field must resolve to EXACTLY ONE\n" +
"         distinct value or the frame does not qualify - a serialization\n" +
"         naming two patients, encounters, appointments, providers or service\n" +
"         dates refuses instead of guessing. Values are compared, never\n" +
"         logged. */\n" +
"      try {\n" +
"        var metas = deepQueryAll(frame.doc, 'meta').filter(function (m) { return /encounter_id/.test(m.getAttribute('content') || ''); });\n" +
"        if (metas.length !== 1) return null;\n" +
"        var arr = JSON.parse(metas[0].getAttribute('content'));\n" +
"        if (!Array.isArray(arr)) return null;\n" +
"        var ctx = {};\n" +
"        for (var ai = 0; ai < arr.length; ai++) { var it = arr[ai]; if (it && typeof it === 'object') { for (var ck in it) { if (Object.prototype.hasOwnProperty.call(it, ck)) ctx[ck] = String(it[ck]); } } }\n" +
"        var encId = digits(ctx.encounter_id || ''), metaPatient = digits(ctx.patient_id || '');\n" +
"        var wantMrn = digits(expectedPatient.mrn);\n" +
"        if (!encId || encId.length < 3 || !metaPatient || !wantMrn || metaPatient !== wantMrn) return null;\n" +
"        var html = '';\n" +
"        try { html = String(frame.doc.body ? frame.doc.body.innerHTML : ''); } catch (eHtml) { return null; }\n" +
"        if (html.length > 6000000) html = html.slice(0, 6000000);\n" +
"        function hetUniq(re, mapFn) {\n" +
"          var seen = {}, out = [], m2;\n" +
"          while ((m2 = re.exec(html))) { var v = mapFn ? mapFn(m2[1]) : m2[1]; if (v && !seen[v]) { seen[v] = 1; out.push(v); if (out.length > 3) break; } }\n" +
"          return out;\n" +
"        }\n" +
"        var appts = hetUniq(/\"AppointmentID\\\\?\"\\s*:\\s*\\\\?\"(\\d{3,})/g);\n" +
"        if (appts.length !== 1) return null;\n" +
"        var provs = hetUniq(/\"DisplayName\\\\?\"\\s*:\\s*\\\\?\"([^\"\\\\]{4,70})\\\\?\"/g, function (v) { return /,\\s*(?:MD|DO|PA-C|CRNP|NP|DPM)\\s*$/.test(v) ? v : ''; });\n" +
"        if (provs.length !== 1) return null;\n" +
"        var dates = hetUniq(/\"(?:Scheduled|Appointment|Service|Visit|Appt)[A-Za-z]*Date\\\\?\"[^0-9]{0,80}?(\\d{4}-\\d{2}-\\d{2})/g);\n" +
"        if (dates.length !== 1) return null;\n" +
"        var visitDate = dateKey(dates[0]);\n" +
"        if (!visitDate) return null;\n" +
"        return { encounterId: encId, appointmentId: digits(appts[0]), provider: text(provs[0]), visitDate: visitDate };\n" +
"      } catch (eHet) { return null; }\n" +
"    }\n" +
HELPER_ANCHOR;
spliceOne('stage-context-helper', HELPER_ANCHOR, HELPER);

/* ---- 2: the candidate loop's identity acquisition grows the het branch ---- */
const OLD_ID = "      var chartHeader = anchoredIdentity(fr), observedIdentity = chartHeader.identity;\n      if (!observedIdentity || chartHeader.ambiguous) continue;";
const NEW_ID = "      var chartHeader = anchoredIdentity(fr), observedIdentity = chartHeader.identity;\n" +
"      var hetStage = null;\n" +
"      if (!observedIdentity && !chartHeader.ambiguous) {\n" +
"        /* het-1.0.0: stage surfaces split banner and editor across frames.\n" +
"           Qualify ONLY when the frame's own machine-typed context META names\n" +
"           the expected patient AND an ANCESTOR frame's banner (never a\n" +
"           sibling) passes the exact same identity gates below. */\n" +
"        hetStage = hetStageEncounterContext(fr, expectedPatient);\n" +
"        if (hetStage) {\n" +
"          var hetAncWin = null; try { hetAncWin = fr.w && fr.w.parent && fr.w.parent !== fr.w ? fr.w.parent : null; } catch (eHet0) { hetAncWin = null; }\n" +
"          var hetHops = 0;\n" +
"          while (hetAncWin && hetHops++ < 6 && !observedIdentity) {\n" +
"            var hetFr = null;\n" +
"            for (var hfi = 0; hfi < frames.length; hfi++) { if (frames[hfi].w === hetAncWin) { hetFr = frames[hfi]; break; } }\n" +
"            if (!hetFr) break;\n" +
"            var hetHeader = anchoredIdentity(hetFr);\n" +
"            if (hetHeader.ambiguous) { chartHeader = hetHeader; break; }\n" +
"            if (hetHeader.identity) { chartHeader = hetHeader; observedIdentity = hetHeader.identity; break; }\n" +
"            try { hetAncWin = hetAncWin.parent && hetAncWin.parent !== hetAncWin ? hetAncWin.parent : null; } catch (eHet1) { hetAncWin = null; }\n" +
"          }\n" +
"          if (!observedIdentity) hetStage = null;\n" +
"        }\n" +
"      }\n" +
"      if (!observedIdentity || chartHeader.ambiguous) continue;";
spliceOne('identity-het-branch', OLD_ID, NEW_ID);

/* ---- 3: the three observed-context sources prefer the machine-typed stage
       context when the het path qualified the frame ---- */
spliceOne('eid-source',
  "      var eid = encounterIdFor(fr, targetRoot, observedIdentity.root);",
  "      var eid = hetStage ? hetStage.encounterId : encounterIdFor(fr, targetRoot, observedIdentity.root);");
spliceOne('appt-source',
  "      var observedAppointmentId = appointmentIdFor(fr, targetRoot, observedIdentity.root);",
  "      var observedAppointmentId = hetStage ? hetStage.appointmentId : appointmentIdFor(fr, targetRoot, observedIdentity.root);");
spliceOne('meta-source',
  "      var encounterMeta = encounterMetadataFor(fr, targetRoot, observedIdentity.root);",
  "      var encounterMeta = hetStage ? { root: targetRoot, visitDate: hetStage.visitDate, provider: hetStage.provider } : encounterMetadataFor(fr, targetRoot, observedIdentity.root);");

/* EOL law: normalize the two inserted blocks to LF like the sim/stx regions */
[['    function hetStageEncounterContext', HELPER_ANCHOR],
 ['      var chartHeader = anchoredIdentity(fr), observedIdentity = chartHeader.identity;', '      if (!observedIdentity || chartHeader.ambiguous) continue;']].forEach(function (pair) {
  const s0 = src.indexOf(pair[0]);
  const e0 = src.indexOf(pair[1], s0);
  if (s0 < 0 || e0 < 0) throw new Error('het-splice: normalize block not found');
  const end = e0 + pair[1].length;
  src = src.slice(0, s0) + src.slice(s0, end).replace(/\r\n/g, '\n') + src.slice(end);
});

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.0 spliced OK');
