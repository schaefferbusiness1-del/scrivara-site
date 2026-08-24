'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tuningSource = fs.readFileSync(path.join(root, 'feat_mls_draft_tuning.js'), 'latin1');
const shells = [
  '1pScribeFlow.html',
  path.join('1p', 'index.html'),
];

for (const file of shells) {
  const source = fs.readFileSync(path.join(root, file), 'latin1');
  assert.match(source, /forStructured\s*\(/, `${file}: structured SOAP route does not request nested HPI tuning`);
  for (const section of ['hpi', 'ros', 'exam', 'assessment', 'plan']) {
    assert.match(tuningSource, new RegExp(`\\b${section}: mergeFamily\\('${section}', nested && nested\\.${section}\\)`), `${file}: structured SOAP tuning module lost ${section}`);
  }
  assert.match(source, /_draftFamily=opts\.freeform&&_familyAllow\.indexOf\(_requestedFamily\)>=0\?_requestedFamily:\(opts\.freeform\?'general_draft':'soap'\)/, `${file}: a non-SOAP display style can silently discard nested section profiles`);
  assert.match(source, /draftFamily:_draftFamily\|\|'soap', draftTuning:_draftTuning/, `${file}: structured generation lost its fail-closed SOAP-family fallback`);
  assert.match(source, /'hpi','ros','exam','assessment','plan'/, `${file}: direct section regeneration allowlist omits one or more exact Athena sections`);
  assert.match(source, /family:'copilot',[\s\S]{0,120}draftTuning:/, `${file}: Copilot artifact edit does not send bounded tuning`);
  assert.match(source, /question:q, context:snapshot, history:hist\.slice\(0,-1\), draftTuning:/, `${file}: Copilot answer does not send bounded tuning`);
  assert.match(source, /type:type,context:context,instructions:focus,family:'legal_ime',draftSubtype:legalDraftSubtypeFor\(type,false\),draftTuning:/, `${file}: legal report does not send explicit subtype + legal_ime tuning`);
  assert.match(source, /prompt:a\.prompt,system:a\.system,family:'studio_widget',draftTuning:/, `${file}: widget AI does not send studio_widget tuning`);
  assert.match(source, /prompt:a\.prompt,system:'You output ONLY valid minified JSON[^\n]+family:'studio_widget',draftTuning:/, `${file}: widget JSON AI does not send studio_widget tuning`);
}

for (const file of shells) {
  const source = fs.readFileSync(path.join(root, file), 'latin1');
  for (const style of ['apso', 'narrative', 'problem', 'hp']) {
    assert.match(source, new RegExp(`${style}:'FORMAT THE NOTE AS`), `${file}: ${style} display style fixture disappeared`);
  }
  assert.match(source, /Every non-freeform visit request is the same structured clinical-note[\s\S]{0,520}_draftFamily=opts\.freeform/, `${file}: structured tuning rationale disappeared`);
}

const canonical = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'latin1');
for (const [label, shell] of [['1pScribeFlow.html', canonical], ['1p/index.html', fs.readFileSync(path.join(root, '1p/index.html'), 'latin1')]]) {
  assert.match(shell, /Account default/, `${label}: one-visit section picker must preserve the account-selected profile by default`);
  assert.match(shell, /if\(sel&&sel\.value\) families\[key\]=\{profileId:sel\.value\}/, `${label}: picker must send an override only after an explicit selection`);
  assert.match(shell, /profileId:sel\.value/, `${label}: picker does not transport selected profile ids`);
  assert.match(shell, /function clearGenSectionProfileOverrides/, `${label}: picker must clear explicit overrides for a new visit`);
  assert.match(shell, /clearGenSectionProfileOverrides\(\);/, `${label}: new-visit reset must clear stale section overrides`);
}

console.log('PASS draft-tuning route reach: all five nested/direct note sections, Copilot, legal, and widget transports are wired in both /1p shells');
