'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  assert(start >= 0, `missing start marker: ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert(end > start, `missing end marker: ${endText}`);
  return source.slice(start, end).trim();
}

const readerSource = sliceBetween(
  background,
  'function mlsAlreadyOpenEncounterReaderFn(expectedAppointmentId, expectedPatientId, expectedScheduleDate)',
  'function mlsAlreadyOpenIdentityDecision(lightIdentity, shadowIdentity, expectedName, expectedDob, expectedMrn)'
);
const identityDecisionSource = sliceBetween(
  background,
  'function mlsAlreadyOpenIdentityDecision(lightIdentity, shadowIdentity, expectedName, expectedDob, expectedMrn)',
  'function mlsEncounterAcceptanceReaderFn()'
);
const shadowReaderSource = sliceBetween(
  background,
  'function mlsReadChartIdentityShadow()',
  '/* v1.78 helper: run the shadow reader across all frames'
);

const appointmentId = '730001';
const patientId = '740001';
const encounterId = '750001';
const scheduleDate = '2026-08-25';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    async function readFixture(options = {}) {
      const routeEncounter = options.routeEncounter || encounterId;
      const metaEncounter = options.metaEncounter || encounterId;
      const metaPatient = options.metaPatient || patientId;
      const hydrationAppointment = options.hydrationAppointment || appointmentId;
      const pathname = options.pathname || `/ax/encounter/${routeEncounter}/intake`;
      const currentEntry = {
        /* Deliberately conflicting outer decoys: only the fields owned by
           clinical_encounter are authoritative in the live hydration shape. */
        PatientID: options.outerPatient || '749999',
        AppointmentID: options.outerAppointment || '739999',
        clinical_encounter: {
          ID: options.entryEncounter || encounterId,
          PatientID: options.entryPatient || patientId,
          AppointmentID: hydrationAppointment,
          EncounterDate: { __CLASS__: 'Date', Date: options.encounterDate || scheduleDate }
        },
        appointment: {
          ID: options.nestedAppointment || hydrationAppointment,
          FullAppointmentDate: { __CLASS__: 'Date', Date: options.fullDate || scheduleDate },
          LocalFullAppointmentDate: { __CLASS__: 'Date', Date: options.localDate || scheduleDate }
        }
      };
      const hydration = Object.assign({ current: currentEntry }, options.extraEntries || {});
      const body = `<html><head><meta content='${JSON.stringify([{ encounter_id: metaEncounter }, { patient_id: metaPatient }])}'></head><body>` +
        `<script id="inline-page-data" type="application/json">${JSON.stringify(hydration)}</script>` +
        `</body></html>`;
      await page.route('https://athena.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body }), { times: 1 });
      await page.goto(`https://athena.example${pathname}`);
      return page.evaluate(({ source, appointmentId, patientId, scheduleDate }) => {
        const reader = (0, eval)(`(${source})`);
        return reader(appointmentId, patientId, scheduleDate);
      }, { source: readerSource, appointmentId, patientId, scheduleDate });
    }

    const exactResult = await readFixture();
    assert.strictEqual(exactResult.matched, true, 'exact already-open encounter was not recognized');
    assert.strictEqual(exactResult.reason, 'matched', 'exact already-open encounter lacked a PHI-free match code');
    assert.strictEqual((await readFixture({ hydrationAppointment: '730002' })).matched, false, 'different appointment hydration was accepted');
    assert.strictEqual((await readFixture({ entryPatient: '740002', outerPatient: patientId })).matched, false, 'expected outer PatientID replaced a conflicting clinical-encounter patient');
    assert.strictEqual((await readFixture({ hydrationAppointment: '730002', outerAppointment: appointmentId })).matched, false, 'expected outer AppointmentID replaced a conflicting clinical-encounter appointment');
    assert.strictEqual((await readFixture({ metaPatient: '740002' })).matched, false, 'different patient metadata was accepted');
    assert.strictEqual((await readFixture({ metaEncounter: '750002' })).matched, false, 'route/metadata encounter mismatch was accepted');
    assert.strictEqual((await readFixture({ fullDate: '2026-08-26' })).matched, false, 'conflicting structured appointment date was accepted');
    assert.strictEqual((await readFixture({ nestedAppointment: '730002' })).matched, false, 'nested appointment ID conflict was accepted');
    const crossObjectResult = await readFixture({
      hydrationAppointment: '730002',
      extraEntries: {
        unrelated: {
          PatientID: '749998',
          AppointmentID: '739998',
          clinical_encounter: { ID: '750002', PatientID: patientId, AppointmentID: appointmentId, EncounterDate: { __CLASS__: 'Date', Date: scheduleDate } },
          appointment: { ID: appointmentId, FullAppointmentDate: { __CLASS__: 'Date', Date: scheduleDate } }
        }
      }
    });
    assert.strictEqual(crossObjectResult.matched, false, 'route encounter was joined to the requested appointment from another hydration object');
    assert.strictEqual(crossObjectResult.reason, 'related-context-ambiguous', 'cross-object refusal lacked its PHI-free diagnostic code');
    assert.strictEqual((await readFixture({
      extraEntries: {
        duplicate: {
          PatientID: '749997',
          AppointmentID: '739997',
          clinical_encounter: { ID: encounterId, PatientID: patientId, AppointmentID: appointmentId, EncounterDate: { __CLASS__: 'Date', Date: '2026-08-26' } },
          appointment: { ID: appointmentId, FullAppointmentDate: { __CLASS__: 'Date', Date: '2026-08-26' } }
        }
      }
    })).matched, false, 'conflicting duplicate exact context was accepted');
    assert.strictEqual((await readFixture({ pathname: '/schedule/day' })).matched, false, 'a non-encounter route was accepted');

    async function readShadowFixture(first, last, dob, mrn) {
      await page.setContent('<html><body><div id="patient-banner"></div></body></html>');
      return page.evaluate(({ source, first, last, dob, mrn }) => {
        const host = document.getElementById('patient-banner');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<div>First Name Used</div><div>${first}</div><div>Legal Last Name</div><div>${last}</div><div>Date of Birth</div><div>${dob}</div><div>Patient ID</div><div>#${mrn}</div>`;
        const reader = (0, eval)(`(${source})`);
        return reader();
      }, { source: shadowReaderSource, first, last, dob, mrn });
    }
    const expectedIdentity = await readShadowFixture('Test', 'Sample', '01/02/1980', patientId);
    const wrongIdentity = await readShadowFixture('Other', 'Sample', '03/04/1970', '740002');
    assert.strictEqual(expectedIdentity.via, 'shadow-labels', 'actual open-shadow label reader did not produce strong identity');
    const lightIdentity = { name: 'Test Sample', dob: '01/02/1980', mrn: patientId, via: 'banner', score: 8 };
    const decideIdentity = (light, shadow) => {
      const decide = (0, eval)(`(${identityDecisionSource})`);
      return decide(light, shadow, 'Test Sample', '01/02/1980', patientId);
    };
    assert.strictEqual(decideIdentity(null, Object.assign({}, expectedIdentity, { candidates: [expectedIdentity] })).matched, true,
      'an empty light DOM did not fall back to an exact strong same-frame shadow identity');
    assert.strictEqual(decideIdentity(null, Object.assign({}, wrongIdentity, { candidates: [wrongIdentity] })).matched, false,
      'a wrong strong shadow identity passed the exact patient gate');
    const conflictDecision = decideIdentity(lightIdentity, Object.assign({}, wrongIdentity, { candidates: [wrongIdentity] }));
    assert.strictEqual(conflictDecision.matched, false, 'conflicting credible light and shadow identities were accepted');
    assert.strictEqual(conflictDecision.reason, 'identity-conflict', 'credible identity conflict lacked an explicit refusal code');

    const shortcut = background.indexOf("func: mlsAlreadyOpenEncounterReaderFn");
    const recovery = background.indexOf('if (__mlsReadsSinceReload >= 5', shortcut);
    const scheduleOpen = background.indexOf("func: mlsSearchOpenDriverFn", shortcut);
    assert(shortcut >= 0 && recovery > shortcut && scheduleOpen > shortcut,
      'already-open proof does not run before recovery and schedule navigation');
    assert(background.includes("target: { tabId: tab.id, frameIds: [alreadyFrameId] }, func: mlsReadChartIdentity"),
      'banner identity is not read from the same exact hydration frame');
    assert(background.includes("target: { tabId: tab.id, frameIds: [alreadyFrameId] }, func: mlsReadChartIdentityShadow") &&
      background.includes('mlsAlreadyOpenIdentityDecision(alreadyIdentity, alreadyShadowIdentity'),
      'same-frame shadow identity fallback is absent');
    assert(background.includes("via: 'already-open-appointment'") && background.includes('appointmentIdBound: true'),
      'successful short-circuit does not return an exact appointment-bound receipt');
    assert(background.includes('reasonCodes: []') &&
      background.includes('diag: searchOpenDiag((sched && sched.diag) || null)') &&
      background.includes("diag: searchOpenDiag(Object.assign({}, (sched && sched.diag) || {}, __navDiag, { appointmentNavigationProven: false }))") /* navproof-diag-1.0.0 (3.0.136): the refusal carries the opener diag and closed counts */,
      'final exact-open refusals do not expose the bounded already-open reason codes and booleans');

    console.log('PASS already-open exact appointment: route/meta encounter, patient id, appointment hydration, single visit date, and same-frame banner identity all gate the zero-navigation short-circuit');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
