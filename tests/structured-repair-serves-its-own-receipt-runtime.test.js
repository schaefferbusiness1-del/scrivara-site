'use strict';
/* repairadv-1.0.0 (2026-09-24): THE LINES TO CHECK BELONG TO THE NOTE THAT
 * WAS SERVED.
 *
 * When /api/generate refuses a draft for an unsupported clinical claim, the
 * site asks /api/complete for one conservative structured_note_repair and
 * serves THAT note. The backend now answers the repair with the same quality
 * receipt /api/generate carries ({status, issues, flagged:[{issue, sentence,
 * arm}]}). Before this change the client read only payload.content, so the
 * visit room's amber list described whatever advisory was parked before (the
 * run's cleared null, or another draft's doubts) instead of the repair.
 *
 * This suite EXECUTES the shipped repair and the shipped noteadv block from
 * both canonical shells and proves:
 *   - a successful repair parks its own cleaned receipt (review and ok);
 *   - AN OLD-SERVER REPLY with no quality leaves the parked advisory exactly
 *     as it was (the same object, or null);
 *   - a refused repair (malformed note, non-2xx) parks nothing;
 *   - end to end through aiCallRaw: /api/generate 502 -> repair -> the stamp
 *     the visit room reads names the repair's flagged sentence.
 * Every sentence below is invented for this file.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
let checks = 0;
function ok(v, msg) { assert.ok(v, msg); checks += 1; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); checks += 1; }
function deq(a, b, msg) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, msg); checks += 1; }

function between(text, a, b, label) {
  const start = text.indexOf(a);
  assert.ok(start >= 0, 'missing span start: ' + label);
  const end = text.indexOf(b, start + a.length);
  assert.ok(end > start, 'missing span end: ' + label);
  return text.slice(start, end);
}

const NOTE = ['HPI:', 'Synthetic documented history for today.', '', 'ROS:', "Not documented in today's transcript.", '',
  'EXAM:', "Not documented in today's transcript.", '', 'ASSESSMENT:', 'Synthetic documented assessment.', '',
  'PLAN:', 'Synthetic documented follow-up in two weeks.'].join('\n');
const REPAIRED = JSON.stringify({ note: NOTE });
const REVIEW = { status: 'review', issues: ['plan_evidence'], flagged: [{ issue: 'plan_evidence', sentence: 'Synthetic documented follow-up in two weeks.', arm: 'display' }] };
const REVIEW_CLEAN = { status: 'review', issues: ['plan_evidence'], flagged: [{ issue: 'plan_evidence', sentence: 'Synthetic documented follow-up in two weeks.', arm: 'display', lost: false }] };
const STALE = Object.freeze({ status: 'review', issues: ['old_draft'], flagged: [{ issue: 'old_draft', sentence: 'Synthetic sentence from a draft that was not served.', arm: 'display', lost: false }] });

(async function () {
  for (const file of SHELLS) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const REPAIR_BLOCK = between(source, 'function _mlsStructuredNoteQualityError(', '\nfunction _mlsAthenaSourceState(', file + ' repair block');
    const NOTEADV_BLOCK = between(source, '/* ===== noteadv-1.0.0 (owner 2026-09-11) - THE LINES', '/* ===== end noteadv-1.0.0 ===== */', file + ' noteadv block');
    const TRANSPORT_BLOCK = between(source, 'function _mlsTemplateRoutingSource(', '\nasync function postChat(', file + ' transport block');
    ok(REPAIR_BLOCK.includes('window.__mlsLastNoteAdvisory=_mlsNoteAdvisoryFromQuality(payload.quality)'), file + ': the repair no longer parks its own receipt');

    function boot(reply) {
      const calls = [];
      const sandbox = {
        String, Number, Object, Array, RegExp, JSON, Date, Math, Promise, AbortController,
        bkBase: () => 'https://synthetic.invalid', bkToken: () => 'synthetic-token', getNoteModel: () => 'synthetic-model',
        parseGenJSON: value => JSON.parse(value),
        fetch: async (url, init) => { calls.push(url); return typeof reply === 'function' ? reply(url, init) : reply; }
      };
      sandbox.window = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(NOTEADV_BLOCK + '\n' + REPAIR_BLOCK, sandbox, { filename: file + ':repair' });
      return { sandbox, calls };
    }
    const okReply = payload => ({ ok: true, status: 200, json: async () => payload });

    /* ---- 1. a new server's review receipt replaces the stale advisory ---- */
    {
      const { sandbox } = boot(okReply({ content: REPAIRED, model: 'synthetic', quality: REVIEW, qualityRetried: false }));
      sandbox.__mlsLastNoteAdvisory = STALE;
      eq(await sandbox._mlsRepairUnsupportedClinicalClaim('SYSTEM', 'synthetic source', {}), REPAIRED, file + ': the repair content is no longer returned byte for byte');
      deq(sandbox.__mlsLastNoteAdvisory, REVIEW_CLEAN, file + ': the served repair did not park its own flagged sentence');
      deq(sandbox.__mlsLastNoteAdvisory, JSON.parse(JSON.stringify(sandbox._mlsNoteAdvisoryFromQuality(REVIEW))), file + ': the parked receipt was not cleaned by the one advisory reader');
    }
    /* ---- 2. an ok receipt says ok (the stale doubts are gone) ---- */
    {
      const { sandbox } = boot(okReply({ content: REPAIRED, quality: { status: 'ok', issues: [], flagged: [] } }));
      sandbox.__mlsLastNoteAdvisory = STALE;
      await sandbox._mlsRepairUnsupportedClinicalClaim('SYSTEM', 'synthetic source', {});
      deq(sandbox.__mlsLastNoteAdvisory, { status: 'ok', issues: [], flagged: [] }, file + ': a clean repair kept another draft\'s doubted lines');
    }
    /* ---- 3. an old server: no quality, the parked advisory is untouched ---- */
    for (const parked of [STALE, null, undefined]) {
      const { sandbox } = boot(okReply({ content: REPAIRED, model: 'synthetic' }));
      sandbox.__mlsLastNoteAdvisory = parked;
      eq(await sandbox._mlsRepairUnsupportedClinicalClaim('SYSTEM', 'synthetic source', {}), REPAIRED, file + ': an old-server repair is no longer served');
      eq(sandbox.__mlsLastNoteAdvisory, parked, file + ': an old-server repair (no quality) changed the parked advisory (' + String(parked && 'stale') + ')');
    }
    for (const quality of [null, 'review', 7]) {
      const { sandbox } = boot(okReply({ content: REPAIRED, quality }));
      sandbox.__mlsLastNoteAdvisory = STALE;
      await sandbox._mlsRepairUnsupportedClinicalClaim('SYSTEM', 'synthetic source', {});
      eq(sandbox.__mlsLastNoteAdvisory, STALE, file + ': a quality field that is not a receipt (' + JSON.stringify(quality) + ') changed the parked advisory');
    }
    /* A receipt object that does not read as one parks what the one reader
       makes of it, exactly as the /api/generate stash does. */
    {
      const { sandbox } = boot(okReply({ content: REPAIRED, quality: { status: 'weird' } }));
      sandbox.__mlsLastNoteAdvisory = STALE;
      await sandbox._mlsRepairUnsupportedClinicalClaim('SYSTEM', 'synthetic source', {});
      eq(sandbox.__mlsLastNoteAdvisory, null, file + ': an unreadable receipt object was not treated like the /api/generate stash treats one');
    }
    /* ---- 4. a refused repair parks nothing ---- */
    {
      const bad = JSON.stringify({ note: '**HPI:**\nSynthetic.\n\n**Signature:**\n____' });
      const { sandbox } = boot(okReply({ content: bad, quality: REVIEW }));
      sandbox.__mlsLastNoteAdvisory = STALE;
      let thrown = null;
      try { await sandbox._mlsRepairUnsupportedClinicalClaim('SYSTEM', 'synthetic source', {}); } catch (e) { thrown = e; }
      ok(thrown && thrown.mlsStructuredNoteQuality, file + ': a malformed repair was served');
      eq(sandbox.__mlsLastNoteAdvisory, STALE, file + ': a refused repair parked its receipt');
    }
    for (const reply of [{ ok: false, status: 502, json: async () => ({ code: 'draft_quality_failed', quality: REVIEW }) }, okReply({ content: '', quality: REVIEW })]) {
      const { sandbox } = boot(reply);
      sandbox.__mlsLastNoteAdvisory = STALE;
      eq(await sandbox._mlsRepairUnsupportedClinicalClaim('SYSTEM', 'synthetic source', {}), '', file + ': a failed repair was served');
      eq(sandbox.__mlsLastNoteAdvisory, STALE, file + ': a failed repair parked a receipt');
    }

    /* ---- 5. end to end: /api/generate refuses, the repair is served, and the
       stamp the visit room reads names the repair's sentence ---- */
    for (const withQuality of [true, false]) {
      const calls = [];
      const sandbox = {
        String, Number, Object, Array, RegExp, JSON, Date, Math, Promise, AbortController,
        backendMode: () => true, bkBase: () => 'https://synthetic.invalid', bkToken: () => 'synthetic-token',
        getNoteModel: () => 'synthetic-model', getGenStyle: () => 'soap', hostedNotePreferences: () => ({}), handle401() {},
        parseGenJSON: value => JSON.parse(value),
        fetch: async url => {
          calls.push(url);
          if (/\/api\/generate$/.test(url)) return { ok: false, status: 502, json: async () => ({ error: 'quality refused', code: 'draft_quality_failed', retryable: true, issues: ['unsupported_clinical_claim'] }) };
          return okReply(withQuality ? { content: REPAIRED, quality: REVIEW, qualityRetried: false } : { content: REPAIRED });
        }
      };
      sandbox.window = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(NOTEADV_BLOCK + '\n' + REPAIR_BLOCK + '\n' + TRANSPORT_BLOCK, sandbox, { filename: file + ':transport' });
      sandbox._mlsBeginVisitNoteAdvisoryRun();
      const served = await sandbox.aiCallRaw('SYSTEM', 'TODAY_TRANSCRIPT_BEGIN\nsynthetic visit\nTODAY_TRANSCRIPT_END', '', { resolvedDraftTuning: {} });
      deq(calls, ['https://synthetic.invalid/api/generate', 'https://synthetic.invalid/api/complete'], file + ': the refusal did not take its one repair');
      eq(served, REPAIRED, file + ': the repaired note was not served');
      const stamp = sandbox._mlsStampVisitNoteAdvisory();
      if (withQuality) {
        eq(stamp.status, 'review', file + ': the visit room does not see the served repair\'s doubted line');
        deq(stamp.flagged, REVIEW_CLEAN.flagged, file + ': the visit room shows the wrong lines for the served repair');
      } else {
        eq(sandbox.__mlsLastNoteAdvisory, null, file + ': an old-server repair parked something where nothing was');
        eq(stamp.status, 'ok', file + ': an old-server repair no longer stamps the plain ok it stamped before');
        deq(stamp.flagged, [], file + ': an old-server repair stamped flagged lines');
      }
    }
  }
  console.log('PASS structured repair serves its own receipt: ' + checks + ' checks in ' + SHELLS.length + ' shells; the served repair parks its own flagged lines, an old-server repair leaves the advisory exactly as it was, and a refused repair parks nothing');
})().catch(error => { console.error(error); process.exit(1); });
