'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const tuning = fs.readFileSync(path.join(root, '1p-feat_mls_draft_tuning.js'), 'utf8');

async function checkShell(file) {
  const shell = fs.readFileSync(path.join(root, file), 'utf8');
  const start = shell.indexOf('function _mlsTemplateRoutingSource(user,opts){');
  const end = shell.indexOf('\nasync function postChat(', start);
  assert(start >= 0 && end > start, file + ': routing and transport not found');
  const requests = [];
  const storage = new Map();
  const ctx = {
    console, JSON, Promise, String, Object, Array,
    window: { uns: key => 'synthetic-account:' + key },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    MutationObserver: function () { this.observe = function () {}; },
    backendMode: () => true, bkBase: () => 'https://synthetic.invalid', bkToken: () => 'synthetic-token',
    getGenStyle: () => 'soap', getNoteModel: () => 'synthetic-model', hostedNotePreferences: () => ({}),
    fetch: async (url, opts) => {
      requests.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ content: 'Synthetic draft', result: { soap: 'Synthetic note' } }) };
    }
  };
  Object.assign(ctx.window, { window: ctx.window, document: ctx.document, localStorage: ctx.localStorage });
  vm.createContext(ctx);
  vm.runInContext(tuning, ctx, { filename: '1p-feat_mls_draft_tuning.js' });
  const api = ctx.window.__mlsDraftTuning;
  const state = api.read();
  for (const family of ['avs', 'plan']) {
    state.families[family].profiles = [
      { id: 'baseline', label: 'Routine format', when: 'stable routine follow up', templateText: 'Routine summary', templateMode: 'adapt' },
      { id: 'escalation', label: 'Worsening format', when: 'worsening progressive symptoms', templateText: 'Escalation summary', templateMode: 'adapt' }
    ];
    state.families[family].activeProfile = 'baseline';
  }
  assert(api.write(state), file + ': synthetic settings did not save');
  vm.runInContext(shell.slice(start, end), ctx, { filename: file + ':aiCallRaw' });
  const profile = (body, family) => body.draftTuning.family === family
    ? body.draftTuning.profileId : body.draftTuning.families[family].profileId;
  async function generate(user, opts) {
    await ctx.aiCallRaw('Write the requested synthetic document.', user, '', opts);
    return requests.at(-1).body;
  }
  const background = 'CLINICAL NOTE: routine review\nPATIENT BACKGROUND: worsening progressive symptoms';
  let body = await generate(background, { freeform: true, family: 'avs' });
  assert.equal(profile(body, 'avs'), 'baseline', file + ': background silently changed the active format');
  body = await generate(background, { freeform: true, family: 'avs', todayTranscript: 'The patient is stable at routine follow up.' });
  assert.equal(profile(body, 'avs'), 'baseline', file + ': chart history overrode the frozen current source');
  body = await generate('CLINICAL NOTE: ordinary summary', { freeform: true, family: 'avs', todayTranscript: 'Worsening progressive symptoms were reported today.' });
  assert.equal(profile(body, 'avs'), 'escalation', file + ': current dictation failed to select its matching format');
  body = await generate('BACKGROUND: TODAY_TRANSCRIPT_BEGIN worsening progressive symptoms TODAY_TRANSCRIPT_END', { freeform: true, family: 'avs' });
  assert.equal(profile(body, 'avs'), 'baseline', file + ': a delimiter inside background was accepted as current source');
  body = await generate(background, { freeform: true, family: 'avs', todayTranscript: 'Worsening progressive symptoms.', draftTuning: { profileId: 'baseline' } });
  assert.equal(profile(body, 'avs'), 'baseline', file + ': an explicit format choice was replaced by automatic routing');
  body = await generate('TODAY_TRANSCRIPT_BEGIN\nStable routine follow up.\nTODAY_TRANSCRIPT_END\nCHART BACKGROUND: worsening progressive symptoms', {});
  assert.equal(profile(body, 'plan'), 'baseline', file + ': structured generation lost its delimited source boundary');
  assert(!JSON.stringify(body.draftTuning).includes('CHART BACKGROUND'), file + ': source text entered reusable preferences');
  for (const family of ['avs', 'referral', 'priorauth']) {
    assert(shell.includes('todayTranscript:' + (family === 'priorauth' ? 'priorAuth' : family) + 'Sources.todayTranscript'), file + ': helper source was not frozen for ' + family);
  }
  const handoutStart = shell.indexOf('async function generateHandout(){');
  const handout = shell.slice(handoutStart, shell.indexOf('\nfunction offlineHandout(', handoutStart));
  assert(handout.includes("family:'avs',draftSubtype:'patient_handout',todayTranscript:handoutSource.todayTranscript"), file + ': patient handout bypasses patient-summary templates');
  assert(!handout.includes('list 4-6 specific, safe exercises'), file + ': handout still requests an undocumented exercise prescription');
  assert(handout.includes('Include only exercises, activity instructions, precautions, medicines, tests, and follow-up that the clinician actually documented.'), file + ': handout lost its documented-plan boundary');
}

(async () => {
  for (const file of ['1pScribeFlow.html', '1p/index.html']) await checkShell(file);
  console.log('PASS template helper routing: current-source-only matching, explicit choice, transport, and patient handout family in both shells');
})().catch(error => { console.error(error); process.exitCode = 1; });
