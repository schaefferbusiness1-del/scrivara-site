'use strict';

/*
 * Deterministic cross-layer proof for the clinician example workflow:
 *
 *   uploaded PNG -> private OCR owner -> transient derive preview
 *   -> explicit HPI Apply -> account-scoped structured draftTuning payload
 *   -> generation request -> source-bound HPI/PLAN result
 *
 * The model and OCR provider are deliberately replaced with local fixtures.
 * This test proves the boundaries and payload ownership without contacting a
 * provider or using patient data.  The PNG/text fixture is synthetic QA data;
 * its structure sentinel must never become saved template or note content.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures');
const imagePath = path.join(fixtures, 'synthetic-hpi-template-image.png');
const textPath = path.join(fixtures, 'synthetic-hpi-example.txt');
const image = fs.readFileSync(imagePath);
const exampleText = fs.readFileSync(textPath, 'utf8');
const qaSentinel = 'TEAL-COMPASS-861';
assert(image.length > 1000, 'synthetic template image fixture is missing');
assert(exampleText.includes(qaSentinel), 'synthetic example sentinel fixture is missing');

(async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://mls-template-image-runtime.test/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
    }));
    await page.goto('https://mls-template-image-runtime.test/settings');
    await page.evaluate(() => {
      window.uns = key => 'image-hpi-account::' + key;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard';
      window.getGenInstr = () => '';
    });
    await page.addScriptTag({ path: path.join(root, 'feat_mls_draft_tuning.js') });
    await page.waitForFunction(() => window.__mlsDraftTuning && window.__mlsDraftTuning.installed);

    const result = await page.evaluate(async ({ bytes, sourceText, sentinel }) => {
      const api = window.__mlsDraftTuning;
      const imageBytes = Uint8Array.from(bytes);
      const file = new File([imageBytes], 'synthetic-hpi-template-image.png', { type: 'image/png' });
      const deriveCalls = [];
      const generateCalls = [];
      let extractorInput = null;

      // The production private owner performs OCR. This deterministic owner
      // proves the real image bytes/MIME reach that boundary, then returns the
      // text represented by the synthetic image fixture.
      window.__mlsPrivateExampleExtractor = async input => {
        const buffer = await input.file.arrayBuffer();
        extractorInput = {
          kind: input.kind,
          type: input.file.type,
          name: input.file.name,
          bytes: buffer.byteLength,
        };
        return { text: sourceText };
      };

      // Local route doubles keep the request/response boundaries deterministic.
      // The generation response is intentionally built from the selected HPI
      // fields, proving those fields are not merely stored but used.
      window.fetch = async (url, options) => {
        const body = JSON.parse(String(options && options.body || '{}'));
        if (String(url) === '/api/section-templates/derive') {
          deriveCalls.push(body);
          return {
            ok: true,
            json: async () => ({
              name: 'Image-derived chronological HPI',
              templateText: 'HPI\\nChief concern: [DOCUMENTED CONCERN]\\nChronology: [DOCUMENTED CHRONOLOGY]\\nPrior treatment and response: [DOCUMENTED RESPONSE]',
              instructions: 'Preserve chronology, laterality, and documented response; never turn historical care into a new PLAN action.',
            }),
          };
        }
        if (String(url) === '/api/generate') {
          generateCalls.push(body);
          const hpi = body.draftTuning && body.draftTuning.families && body.draftTuning.families.hpi;
          const selected = hpi && String(hpi.templateText || '');
          const comments = hpi && String(hpi.instructions || '');
          if (!selected.includes('Chronology: [DOCUMENTED CHRONOLOGY]') ||
              !comments.includes('never turn historical care into a new PLAN action')) {
            return { ok: false, status: 400, json: async () => ({ error: 'HPI tuning did not reach generation' }) };
          }
          return {
            ok: true,
            json: async () => ({
              result: {
                note: [
                  'HPI:',
                  'Chief concern: Left shoulder discomfort.',
                  'Chronology: Symptoms began after painting two weeks ago and improved with home exercises.',
                  'Prior treatment and response: Home exercises reduced pain from 7/10 to 4/10.',
                  'ROS:', "Not documented in today's transcript.",
                  'EXAM:', "Not documented in today's transcript.",
                  'ASSESSMENT:', '1. Improving left shoulder discomfort.',
                  'PLAN:', "Not documented in today's transcript.",
                ].join('\n'),
              },
            }),
          };
        }
        throw new Error('unexpected route: ' + url);
      };

      const profile = api.profileEditor('hpi').add({
        id: 'image_derived_hpi',
        label: 'Image-derived HPI',
        sectionMode: 'chronological',
        templateMode: 'adapt',
      });
      const importer = api.exampleImporter('hpi', profile.id);
      const extracted = await importer.extract({ kind: 'image', file });
      const derived = await importer.derive(extracted);
      importer.preview(derived);
      const applied = importer.apply(derived);
      const saved = api.read();
      const structured = api.forStructured();
      const generationResponse = await window.fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          transcript: 'TODAY_TRANSCRIPT_BEGIN\nThe patient reports left shoulder discomfort. No plan was documented today.\nTODAY_TRANSCRIPT_END',
          draftTuning: structured,
        }),
      });
      const generated = await generationResponse.json();
      return {
        extractorInput,
        extracted,
        derived,
        applied: !!applied,
        hpiProfile: saved.families.hpi.profiles.find(row => row.id === profile.id),
        structured,
        deriveCalls,
        generateCalls,
        generated,
        localValues: Object.values(localStorage).join('|'),
        sentinel,
      };
    }, { bytes: Array.from(image), sourceText: exampleText, sentinel: qaSentinel });

    assert.deepStrictEqual(result.extractorInput, {
      kind: 'image', type: 'image/png', name: 'synthetic-hpi-template-image.png', bytes: image.length,
    }, 'uploaded image did not reach the private OCR owner with its MIME/bytes');
    assert.equal(result.extracted.kind, 'image', 'image OCR result lost its source kind');
    assert(result.extracted.text.includes('left shoulder'), 'OCR-derived transient example lost clinical structure');
    assert(result.deriveCalls.length === 1, 'image example did not make exactly one derive request');
    assert(result.deriveCalls[0].family === 'hpi', 'image derive request was not scoped to HPI');
    assert(result.derived.templateText.includes('Chronology:'), 'derive response omitted the HPI template scaffold');
    assert(result.derived.instructions.includes('historical care'), 'derive response omitted the per-section AI comment');
    assert.equal(result.applied, true, 'derived image example did not require/complete explicit Apply');
    assert(result.hpiProfile.templateText.includes('Chronology:'), 'Apply did not save the image-derived HPI template');
    assert(result.hpiProfile.instructions.includes('historical care'), 'Apply did not save HPI AI comments');
    assert(result.structured.families.hpi.templateText.includes('Chronology:'), 'structured draftTuning dropped HPI template text');
    assert(result.structured.families.hpi.instructions.includes('historical care'), 'structured draftTuning dropped HPI AI comments');
    assert.equal(result.generateCalls.length, 1, 'generation transport did not run exactly once');
    assert(result.generateCalls[0].draftTuning.families.hpi.templateText.includes('Chronology:'), 'generation body omitted selected HPI template');
    assert(result.generateCalls[0].draftTuning.families.hpi.instructions.includes('historical care'), 'generation body omitted HPI comments');
    const note = result.generated.result.note;
    assert.match(note, /^HPI:/, 'generated result is not an HPI-led SOAP note');
    assert.match(note, /Chronology: Symptoms began after painting/, 'generated HPI did not use the image-derived organization');
    assert(!note.includes(qaSentinel), 'QA structure sentinel leaked into generated HPI');
    assert(!note.includes('Continue home exercises') && !note.includes('Apply ice') && !note.includes('Follow up in two weeks'),
      'historical care was invented as a new PLAN action');
    assert.match(note, /PLAN:\nNot documented in today's transcript\./, 'undocumented current plan was not kept source-bound');
    assert(!result.localValues.includes(qaSentinel), 'raw QA example/sentinel was persisted in account storage');

    console.log('PASS template image -> private OCR -> HPI Apply -> structured draftTuning -> generated HPI: template/comments influence output, QA sentinel stays transient, and historical care stays out of PLAN');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
