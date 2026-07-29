'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const target = path.join(root, 'tests', 'e2e', 'run-e2e.js');
const source = fs.readFileSync(target, 'utf8');
const marker = "  await step('template lifecycle: real text import reaches one bound synthetic visit and both template apply paths', async () => {\n";
const markerOccurrences = source.split(marker).length - 1;
const anchor = "  await step('demo local calendar: book through the real form, appears via loadCalendar, check-in stamps, cancel sticks, per-account persistence', async () => {\n";
const occurrences = source.split(anchor).length - 1;

if (markerOccurrences !== 0) {
  throw new Error('024-template-lifecycle-e2e: lifecycle step is already present ' + markerOccurrences + ' time(s)');
}
if (occurrences !== 1) {
  throw new Error('024-template-lifecycle-e2e: expected exactly one calendar-step anchor, found ' + occurrences);
}

const addition = String.raw`  await step('template lifecycle: real text import reaches one bound synthetic visit and both template apply paths', async () => {
    const templateName = 'E2E QA Structured Follow Up';
    const patientName = 'E2E Template Patient';
    const patientDob = '05/06/1985';
    const templateBody = [
      'PATIENT:',
      'VISIT TYPE:',
      'CHIEF CONCERN:',
      'RELEVANT HISTORY:',
      'OBJECTIVE FINDINGS:',
      'ASSESSMENT:',
      'PLAN:',
      'FOLLOW UP:',
      'QA FIXED LINE: SYNTHETIC TEMPLATE LIFECYCLE'
    ].join('\n');
    const before = await page.evaluate(() => ({
      templates: JSON.parse(JSON.stringify(getTemplates())),
      activeTemplate: localStorage.getItem(uns('templateActive')),
      useTemplates: localStorage.getItem(uns('useTemplates')),
      autoTemplate: localStorage.getItem(uns('templateAuto')),
      activePatientId: String(getActivePtId() || ''),
      appointments: JSON.parse(JSON.stringify(window._calAppts || []))
    }));
    let patientId = '';
    let savedNoteId = '';
    try {
      const imported = await page.evaluate(async ({ templateName, templateBody }) => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        openTemplates();
        const uploadText = [
          'Name: ' + templateName,
          'Keywords: office, follow-up, qa-structured',
          templateBody
        ].join('\n');
        const file = new File([uploadText], 'e2e-template-lifecycle.txt', { type: 'text/plain' });
        await tplMultiFile({ target: { files: [file], value: '' } });
        const preview = (window._tplPendingSplit || []).find(item => item && item.name === templateName);
        const add = [...document.querySelectorAll('#tplMultiResult button')]
          .find(button => /Add selected/i.test(button.textContent || ''));
        const rect = add ? add.getBoundingClientRect() : null;
        const style = add ? getComputedStyle(add) : null;
        const addVisible = !!(add && rect && rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden');
        if (add) add.click();
        await sleep(100);
        const saved = getTemplates().find(item => item && item.name === templateName);
        closeTemplates();
        return {
          previewFound: !!preview,
          previewBodyMatches: !!(preview && preview.text === templateBody),
          addVisible,
          savedId: saved ? String(saved.id || '') : '',
          savedBody: saved ? String(saved.text || '') : '',
          savedKeywords: saved && Array.isArray(saved.keywords) ? saved.keywords.slice() : []
        };
      }, { templateName, templateBody });
      assert(imported.previewFound, 'real text File did not produce an import preview');
      assert(imported.previewBodyMatches, 'template metadata was not removed without changing the body');
      assert(imported.addVisible, 'Add selected was not a visible import action');
      assert(imported.savedId, 'Add selected did not save the imported template');
      assert.strictEqual(imported.savedBody, templateBody, 'saved template body differs from the uploaded text body');
      assert.deepStrictEqual(imported.savedKeywords, ['office', 'follow-up', 'qa-structured'], 'uploaded template keywords changed');

      await reloadApp(page);
      await sleep(1200);
      const importedAfterReload = await page.evaluate(({ id, templateName }) => {
        const template = getTemplates().find(item => item && String(item.id) === String(id));
        return {
          found: !!template,
          id: template ? String(template.id || '') : '',
          name: template ? String(template.name || '') : '',
          body: template ? String(template.text || '') : ''
        };
      }, { id: imported.savedId, templateName });
      assert(importedAfterReload.found, 'imported template did not survive reload');
      assert.strictEqual(importedAfterReload.id, imported.savedId, 'template identity changed across reload');
      assert.strictEqual(importedAfterReload.name, templateName, 'template name changed across reload');
      assert.strictEqual(importedAfterReload.body, templateBody, 'template body changed across reload');

      patientId = await addPatient(page, patientName, patientDob);
      const bound = await page.evaluate(async ({ patientId, patientName, patientDob }) => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        try { newVisit(); } catch (e) {}
        setActivePtId(patientId);
        localStorage.setItem(uns('docname'), 'E2E Template Provider MD');
        const today = _acctTodayKey();
        window._calAppts = [{
          id: 'appt-e2e-template-lifecycle',
          name: patientName,
          dob: patientDob,
          appt_date: today,
          start_at: today + 'T11:30:00',
          provider: 'E2E Template Provider MD',
          status: 'booked',
          patient_external_id: patientId,
          reason: 'Structured follow up'
        }];
        showView('visit');
        const engine = window.__mlsEasyV32 && window.__mlsEasyV32.remote;
        try { window.dispatchEvent(new CustomEvent('mls:schedule-updated')); } catch (e) {}
        if (engine && engine.setVisitDay) engine.setVisitDay(today);
        await sleep(800);
        let choose = document.getElementById('ez3Choose');
        for (let i = 0; i < 10 && !choose; i++) {
          if (engine && engine.setVisitDay) engine.setVisitDay(today);
          await sleep(300);
          choose = document.getElementById('ez3Choose');
        }
        if (choose) {
          choose.click();
          await sleep(500);
        }
        const selector = '#visitView [data-hd], #mlsEz3 [data-hd], #visitView [data-q], #mlsEz3 [data-q]';
        let row = document.querySelector(selector);
        for (let i = 0; i < 10 && !row; i++) {
          await sleep(300);
          row = document.querySelector(selector);
        }
        if (row) {
          row.click();
          await sleep(800);
        }
        for (let i = 0; i < 10 && !(engine && engine.snapshot && engine.snapshot().active); i++) await sleep(250);
        const snapshot = engine && engine.snapshot ? engine.snapshot() : null;
        const binding = typeof currentVisitAthenaBinding !== 'undefined' ? currentVisitAthenaBinding : null;
        return {
          rowFound: !!row,
          active: !!(snapshot && snapshot.active),
          activePatientId: String(getActivePtId() || ''),
          bindingId: binding ? String(binding.id || '') : '',
          boundPatientId: binding && binding.patient ? String(binding.patient.patientId || '') : ''
        };
      }, { patientId, patientName, patientDob });
      assert(bound.rowFound, 'synthetic template patient did not render in the real day chooser');
      assert(bound.active, 'synthetic template visit did not become the active visit');
      assert.strictEqual(bound.activePatientId, patientId, 'day chooser activated the wrong synthetic patient');
      assert(bound.bindingId, 'synthetic template visit has no immutable visit binding');
      assert.strictEqual(bound.boundPatientId, patientId, 'visit binding belongs to the wrong synthetic patient');

      const lifecycle = await page.evaluate(async ({ templateId, templateName, patientId, patientName }) => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const result = { templateCalls: 0, unexpectedCalls: [], bridgeWrites: [] };
        const bridgeMessages = [];
        const bridgeListener = event => {
          const data = event && event.data;
          if (data && data.source === 'mls-app') {
            bridgeMessages.push({ type: String(data.type || ''), mode: String(data.mode || '') });
          }
        };
        window.addEventListener('message', bridgeListener);

        openTemplates();
        await sleep(100);
        const search = document.getElementById('tplSearch');
        if (search) {
          search.value = templateName;
          search.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const row = [...document.querySelectorAll('#tplList [role="option"]')]
          .find(option => (option.textContent || '').includes(templateName));
        const rowRect = row ? row.getBoundingClientRect() : null;
        result.templateRowVisible = !!(rowRect && rowRect.width > 0 && rowRect.height > 0);
        if (row) row.click();
        await sleep(100);
        const defaultButton = [...document.querySelectorAll('#tplDetail button')]
          .find(button => /Set default|Default/.test(button.textContent || ''));
        const defaultRect = defaultButton ? defaultButton.getBoundingClientRect() : null;
        result.defaultVisible = !!(defaultRect && defaultRect.width > 0 && defaultRect.height > 0);
        if (defaultButton) defaultButton.click();
        const useToggle = document.getElementById('tplUseToggle');
        if (useToggle && !useToggle.checked) useToggle.click();
        const autoToggle = document.getElementById('tplAutoChoose');
        if (autoToggle && autoToggle.checked) autoToggle.click();
        result.activeTemplate = String(getActiveTemplateId() || '');
        result.useEnabled = useTemplatesOn();
        result.autoEnabled = templateAutoOn();
        closeTemplates();

        const headings = [
          'PATIENT:',
          'VISIT TYPE:',
          'CHIEF CONCERN:',
          'RELEVANT HISTORY:',
          'OBJECTIVE FINDINGS:',
          'ASSESSMENT:',
          'PLAN:',
          'FOLLOW UP:',
          'QA FIXED LINE:'
        ];
        const formatted = mode => [
          'PATIENT: ' + patientName,
          'VISIT TYPE: ' + mode + ' structured follow up',
          'CHIEF CONCERN: Right knee pain for three weeks',
          'RELEVANT HISTORY: No swelling',
          'OBJECTIVE FINDINGS: Full range of motion',
          'ASSESSMENT: Right knee pain',
          'PLAN: Physical therapy',
          'FOLLOW UP: Four weeks',
          'QA FIXED LINE: SYNTHETIC TEMPLATE LIFECYCLE'
        ].join('\n');
        const proof = text => {
          const value = String(text || '');
          const positions = headings.map(heading => value.indexOf(heading));
          return {
            present: positions.every(position => position >= 0),
            ordered: positions.every((position, index) => index === 0 || position > positions[index - 1]),
            unique: headings.every(heading => value.split(heading).length === 2),
            fixedOnce: value.split('QA FIXED LINE: SYNTHETIC TEMPLATE LIFECYCLE').length === 2,
            correctPatient: value.includes('PATIENT: ' + patientName),
            foreignFacts: /E2E Alice Alpha|E2E Bob Beta|left shoulder|bronchitis|penicillin/i.test(value)
          };
        };
        const originalHasAI = window.hasAI;
        const originalCallOpenAI = window.callOpenAI;
        const originalAiCallRaw = window.aiCallRaw;
        const templatePrompts = [];
        try {
          window.hasAI = () => true;
          window.callOpenAI = async () => parseGenJSON(JSON.stringify({
            note: [
              'BASELINE NOTE',
              'PATIENT: ' + patientName,
              'CHIEF CONCERN: Right knee pain for three weeks',
              'RELEVANT HISTORY: No swelling',
              'OBJECTIVE FINDINGS: Full range of motion',
              'ASSESSMENT: Right knee pain',
              'PLAN: Physical therapy',
              'FOLLOW UP: Four weeks'
            ].join('\n'),
            insurance_note: '',
            chief_complaint: 'Right knee pain',
            diagnoses: 'Right knee pain',
            medications: 'None',
            orders: 'Physical therapy',
            follow_up: 'Four weeks',
            em_level: '99213',
            em_justification: 'Synthetic deterministic response',
            icd10: [],
            cpt: [],
            red_flags: [],
            suggested_orders: [],
            differentials: [],
            opioids: [],
            recommendations: []
          }));
          window.aiCallRaw = async (system, user) => {
            if (/Reformat the provided visit note/i.test(String(system || ''))) {
              result.templateCalls += 1;
              templatePrompts.push(String(user || ''));
              return formatted(/MANUAL BASELINE/.test(String(user || '')) ? 'Manual' : 'Automatic');
            }
            result.unexpectedCalls.push(String(system || '').slice(0, 80));
            return '[]';
          };

          const bindingBefore = currentVisitAthenaBinding ? String(currentVisitAthenaBinding.id || '') : '';
          const transcript = [
            'Synthetic patient reports right knee pain for three weeks.',
            'No swelling.',
            'Exam range of motion is full.',
            'Assessment is right knee pain.',
            'Plan is physical therapy.',
            'Follow up in four weeks.'
          ].join(' ');
          const transcriptBox = document.getElementById('transcript');
          transcriptBox.value = transcript;
          transcriptBox.dispatchEvent(new Event('input', { bubbles: true }));
          result.autoGenerated = (await generateNote()) === true;
          result.autoText = String((document.getElementById('noteBox') || {}).value || '');
          result.autoProof = proof(result.autoText);
          result.autoCallCount = result.templateCalls;
          result.autoBinding = currentVisitAthenaBinding ? String(currentVisitAthenaBinding.id || '') : '';

          currentSoap = [
            'MANUAL BASELINE',
            'PATIENT: ' + patientName,
            'CHIEF CONCERN: Right knee pain',
            'PLAN: Physical therapy'
          ].join('\n');
          currentInsurance = '';
          currentFormat = 'soap';
          showNote(currentSoap);
          openTemplates();
          await sleep(100);
          const manualRow = [...document.querySelectorAll('#tplList [role="option"]')]
            .find(option => (option.textContent || '').includes(templateName));
          if (manualRow) manualRow.click();
          await sleep(100);
          const useButton = [...document.querySelectorAll('#tplDetail button')]
            .find(button => /Use on current note/.test(button.textContent || ''));
          const useRect = useButton ? useButton.getBoundingClientRect() : null;
          const useStyle = useButton ? getComputedStyle(useButton) : null;
          result.useNowVisible = !!(useButton && useRect && useRect.width > 0 && useRect.height > 0
            && useStyle.display !== 'none' && useStyle.visibility !== 'hidden');
          if (useButton) useButton.click();
          for (let i = 0; i < 40 && result.templateCalls <= result.autoCallCount; i++) await sleep(50);
          result.manualText = String((document.getElementById('noteBox') || {}).value || '');
          result.manualProof = proof(result.manualText);
          result.manualBinding = currentVisitAthenaBinding ? String(currentVisitAthenaBinding.id || '') : '';
          result.bindingStable = !!bindingBefore
            && bindingBefore === result.autoBinding
            && bindingBefore === result.manualBinding
            && currentVisitAthenaBinding
            && String(currentVisitAthenaBinding.patient && currentVisitAthenaBinding.patient.patientId || '') === String(patientId);
          result.promptHasTemplate = templatePrompts.length >= 2 && templatePrompts.every(prompt =>
            prompt.includes('PATIENT:') &&
            prompt.includes('OBJECTIVE FINDINGS:') &&
            prompt.includes('QA FIXED LINE: SYNTHETIC TEMPLATE LIFECYCLE')
          );
          closeTemplates();
          result.saved = saveCurrentNote(false) === true;
          result.savedNoteId = String(currentNoteId || '');
        } finally {
          window.hasAI = originalHasAI;
          window.callOpenAI = originalCallOpenAI;
          window.aiCallRaw = originalAiCallRaw;
          window.removeEventListener('message', bridgeListener);
          try { closeTemplates(); } catch (e) {}
        }
        result.bridgeWrites = bridgeMessages.filter(message =>
          (message.type === 'mlsAppAthenaActionV2' && message.mode === 'execute') ||
          /^(mlsAppPasteNote|mlsAppPush|mlsAppPushVisit|mlsAppSignAndSave|mlsAppVerifiedWrite|mlsAppWrite)/.test(message.type)
        );
        return result;
      }, { templateId: imported.savedId, templateName, patientId, patientName });

      savedNoteId = lifecycle.savedNoteId;
      assert(lifecycle.templateRowVisible, 'imported template was not visible in the template workspace');
      assert(lifecycle.defaultVisible, 'Set default was not visible for the imported template');
      assert.strictEqual(lifecycle.activeTemplate, imported.savedId, 'visible default action did not select the imported template');
      assert.strictEqual(lifecycle.useEnabled, true, 'visible Templates toggle did not enable template application');
      assert.strictEqual(lifecycle.autoEnabled, false, 'test could not pin explicit-default mode');
      assert(lifecycle.autoGenerated, 'controlled automatic Generate path failed');
      assert(lifecycle.autoCallCount >= 1, 'automatic Generate did not apply the imported template');
      assert(lifecycle.autoProof.present && lifecycle.autoProof.ordered && lifecycle.autoProof.unique && lifecycle.autoProof.fixedOnce,
        'automatic output did not preserve imported headings, order, uniqueness, and fixed line');
      assert(lifecycle.autoProof.correctPatient && !lifecycle.autoProof.foreignFacts,
        'automatic output has the wrong patient or a foreign synthetic fact');
      assert(lifecycle.useNowVisible, 'Use on current note was not visible');
      assert(lifecycle.templateCalls > lifecycle.autoCallCount, 'visible Use on current note did not invoke template formatting');
      assert(lifecycle.manualProof.present && lifecycle.manualProof.ordered && lifecycle.manualProof.unique && lifecycle.manualProof.fixedOnce,
        'manual output did not preserve imported headings, order, uniqueness, and fixed line');
      assert(lifecycle.manualProof.correctPatient && !lifecycle.manualProof.foreignFacts,
        'manual output has the wrong patient or a foreign synthetic fact');
      assert(lifecycle.bindingStable, 'automatic or manual template application changed the patient visit binding');
      assert(lifecycle.promptHasTemplate, 'template application did not send the imported structure to the controlled AI boundary');
      assert.deepStrictEqual(lifecycle.unexpectedCalls, [], 'template lifecycle reached an unexpected AI route');
      assert.deepStrictEqual(lifecycle.bridgeWrites, [], 'local template generation emitted an Athena or extension write');
      assert(lifecycle.saved && savedNoteId, 'template-formatted synthetic note did not save locally');

      await reloadApp(page);
      await sleep(1200);
      const persisted = await page.evaluate(({ templateId, templateBody, patientId, savedNoteId }) => {
        const template = getTemplates().find(item => item && String(item.id) === String(templateId));
        const note = getNotes().find(item => item && String(item.id) === String(savedNoteId));
        const noteText = note ? String(note.soap || note.insurance || '') : '';
        return {
          templateFound: !!template,
          templateBody: template ? String(template.text || '') : '',
          activeTemplate: String(getActiveTemplateId() || ''),
          useEnabled: useTemplatesOn(),
          activePatientId: String(getActivePtId() || ''),
          noteFound: !!note,
          notePatientId: note ? String(note.patientId || '') : '',
          noteHasSentinel: noteText.includes('QA FIXED LINE: SYNTHETIC TEMPLATE LIFECYCLE'),
          noteHasPatient: noteText.includes('PATIENT: E2E Template Patient')
        };
      }, { templateId: imported.savedId, templateBody, patientId, savedNoteId });
      assert(persisted.templateFound, 'imported template disappeared after the clinical lifecycle reload');
      assert.strictEqual(persisted.templateBody, templateBody, 'imported template body changed after the clinical lifecycle reload');
      assert.strictEqual(persisted.activeTemplate, imported.savedId, 'selected template identity did not survive reload');
      assert.strictEqual(persisted.useEnabled, true, 'Templates enabled state did not survive reload');
      assert.strictEqual(persisted.activePatientId, patientId, 'active synthetic patient changed across reload');
      assert(persisted.noteFound && persisted.noteHasSentinel && persisted.noteHasPatient,
        'template-formatted synthetic note did not persist with its structure and patient');
      assert.strictEqual(persisted.notePatientId, patientId, 'persisted template note belongs to the wrong synthetic patient');
    } finally {
      await page.evaluate(({ before, patientId, savedNoteId }) => {
        const restore = (key, value) => {
          if (value === null || value === undefined) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        };
        try { newVisit(); } catch (e) {}
        setTemplates(before.templates || []);
        restore(uns('templateActive'), before.activeTemplate);
        restore(uns('useTemplates'), before.useTemplates);
        restore(uns('templateAuto'), before.autoTemplate);
        if (patientId) {
          savePatients(getPatients().filter(patient => String(patient.id) !== String(patientId)));
          saveNotes(getNotes().filter(note =>
            String(note.patientId || '') !== String(patientId) && String(note.id || '') !== String(savedNoteId || '')
          ));
        }
        window._calAppts = before.appointments || [];
        if (before.activePatientId && findPatient(before.activePatientId)) setActivePtId(before.activePatientId);
        else setActivePtId('');
        try {
          renderTemplateList();
          renderTemplateActiveSelect();
          renderPatients();
          renderProfile();
          renderPatientBar();
          updateNavCounts();
          showView('visit');
        } catch (e) {}
      }, { before, patientId, savedNoteId }).catch(() => {});
    }
  });

`;

fs.writeFileSync(target, source.replace(anchor, addition + anchor), 'utf8');
console.log('024-template-lifecycle-e2e: patched tests/e2e/run-e2e.js');
