'use strict';
/* het-1.0.3 — a per-frame qualification census (hetFrames) beside hetDiag.
 *
 * het-1.0.2 live read {rank:0, metaCount:0} while the encounter META was
 * demonstrably present, meaning the encounter frame most likely never REACHED
 * the het path (its own header parse went ambiguous/mismatch on a transient
 * chart-refresh banner and the classic path consumed it). The refusal now
 * carries hetFrames: for each same-origin frame, closed values only —
 * { i, id: 'own'|'ambig'|'none', het: rank or -1, note: true|false|null }.
 * No urls, no names, no text. */
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
  if (idx < 0) throw new Error('het103: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het103: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* 1: the frames array + per-frame record, created at loop entry */
spliceOne('frames-array',
  "    var frames = sameOriginFrames(), candidates = [], sawOtherPatient = false;\n    for (var fi = 0; fi < frames.length; fi++) {\n      var fr = frames[fi];",
  "    var frames = sameOriginFrames(), candidates = [], sawOtherPatient = false;\n    var hetFrames = [];\n    for (var fi = 0; fi < frames.length; fi++) {\n      var fr = frames[fi];\n      var hetRec = { i: fi, id: '', het: -1, note: null };\n      if (hetFrames.length < 12) hetFrames.push(hetRec);");

/* 2: record the identity verdict */
spliceOne('record-id',
  "      var chartHeader = anchoredIdentity(fr), observedIdentity = chartHeader.identity;\n      var hetStage = null;",
  "      var chartHeader = anchoredIdentity(fr), observedIdentity = chartHeader.identity;\n      hetRec.id = observedIdentity ? 'own' : (chartHeader.ambiguous ? 'ambig' : 'none');\n      var hetStage = null;");

/* 3: record the het rank after the attempt */
spliceOne('record-rank',
  "          if (!observedIdentity) hetStage = null;",
  "          if (!observedIdentity) hetStage = null;\n          hetRec.het = Number(hetDiag.rank || 0);");

/* 4: record the note-target verdict */
spliceOne('record-note',
  "        if (hetStage) hetDiag.noteTargetFound = !!noteTarget;",
  "        if (hetStage) hetDiag.noteTargetFound = !!noteTarget;\n        hetRec.note = !!noteTarget;");

/* 5: the refusal carries the per-frame census */
spliceOne('frames-on-refusal',
  "hetDiag: hetDiag, error: mode === 'teach' && sawOtherPatient ? 'The open Athena chart is not the patient in this review.' : 'Could not identify one exact patient encounter frame.' };",
  "hetDiag: hetDiag, hetFrames: hetFrames, error: mode === 'teach' && sawOtherPatient ? 'The open Athena chart is not the patient in this review.' : 'Could not identify one exact patient encounter frame.' };");

/* EOL: normalize the loop-entry insertion */
const s0 = src.indexOf('    var frames = sameOriginFrames(), candidates = [], sawOtherPatient = false;');
const e0 = src.indexOf('      var chartHeader = anchoredIdentity(fr)');
if (s0 < 0 || e0 < 0 || e0 < s0) throw new Error('het103: normalize span not found');
src = src.slice(0, s0) + src.slice(s0, e0).replace(/\r\n/g, '\n') + src.slice(e0);

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.3 spliced OK');
