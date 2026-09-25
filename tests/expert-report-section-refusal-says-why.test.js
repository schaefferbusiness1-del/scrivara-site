'use strict';
/* =========================================================================
   bla-1.2.0 (2026-09-25): AN EXPERT REPORT SECTION THE SERVER'S SAFETY CHECK
   REFUSED IS SAID AS A REFUSAL.

   The retained-expert report is drafted section by section, each one its own
   legal_section request. When the hosted route's safety check refused a
   section (502 draft_quality_failed) on both attempts, the doctor read only
   "Expert report section 8 could not be generated; retry the complete
   report." - the same words as an outage - after every earlier section had
   been drafted and billed (hunt8 round-2 end-to-end, item 1).

   Now a refusal names the section and says the server's safety check did not
   accept it, and that a retry drafts every section again. Any other failure
   keeps the old words, and a section that passes on its retry still finishes
   the report.

   The real function bodies are read from each shipped shell (the /1p shell,
   its /1p/ copy, production and /cloned) and run in a vm; the message is the
   toast text friendlyError makes of the thrown error. Nothing leaves the
   process.
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
const failures = [];
let checks = 0;
function check(value, message) { checks++; if (!value) failures.push(message); return !!value; }

function fn(source, head) {
  const at = source.indexOf(head);
  if (at < 0) return '';
  const end = source.indexOf('\n}\n', at);
  return source.slice(at, end + 2);
}

function refusal() {
  const error = new Error('502 The draft did not satisfy its family safety contract.');
  error.mlsAi = { status: 502, code: 'draft_quality_failed', retryable: false, detail: 'The draft did not satisfy its family safety contract.', issues: ['unsupported_diagnosis_claim'] };
  return error;
}

/* failAt: the 1-based section that fails; failWith(attempt) returns the
   error for that attempt, or null to answer it. */
async function draft(source, name, failAt, failWith) {
  const body = ['generateExpertReportSections', 'legalDraftSubtypeFor', 'legalSectionRetryable', 'friendlyError', 'mlsDraftFailureMessage'].map((f) => {
    const text = fn(source, (f === 'generateExpertReportSections' ? 'async function ' : 'function ') + f + '(');
    check(!!text, name + ': ' + f + ' is missing from the shell');
    return text;
  }).join('\n');
  const calls = [];
  const context = {
    console, JSON, Number, Math, String, RegExp, Array, Object, Promise, Error,
    getKey: () => '', backendMode: () => true,
    aiCallRaw: async (sys, user, key, opts) => {
      const section = /Now write the "([^"]+)" section in full\./.exec(String(user || ''));
      const header = section ? section[1] : '';
      const index = calls.filter((c) => c.header === header).length + 1;
      calls.push({ header, subtype: opts && opts.draftSubtype, family: opts && opts.family });
      const order = calls.map((c) => c.header).filter((h, i, all) => all.indexOf(h) === i).indexOf(header) + 1;
      if (order === failAt) { const error = failWith(index); if (error) throw error; }
      return 'The records furnished document the facts for this section.';
    }
  };
  vm.createContext(context);
  vm.runInContext(body + '\nthis.__draft = generateExpertReportSections; this.__friendly = friendlyError;', context);
  let out = '', said = '';
  try {
    out = await context.__draft({ attorney: 'Sample Law LLP', caseNo: 'SYN-1', doi: '2026-01-20', jurisdiction: 'Synthetic', questions: 'Causation?', patientRef: 'Ada Sample', recordsBlock: '', chartBlock: 'Synthetic chart.', ownRecord: false, cv: '', note: '', today: '2026-09-25', btn: null, docType: 'Retained expert report' });
  } catch (error) {
    said = context.__friendly(error);
  }
  return { out, said, calls };
}

(async function main() {
  for (const name of SHELLS) {
    const source = fs.readFileSync(path.join(ROOT, name), 'utf8');

    /* 1. section VIII refused by the safety check on both attempts */
    const refused = await draft(source, name, 8, () => refusal());
    check(refused.calls.length === 9 && refused.calls.every((c) => c.subtype === 'legal_section' && c.family === 'legal_ime'),
      name + ': the refused run did not stop at section 8 after its one retry: ' + refused.calls.length + ' calls');
    check(/^Expert report section 8 \(VIII\. EXPERT OPINIONS\) was refused by the server’s safety check/.test(refused.said),
      name + ': a section the safety check refused did not say so: ' + refused.said);
    check(/every section is drafted again/.test(refused.said) && !/could not be generated/.test(refused.said),
      name + ': the refusal does not say a retry drafts every section again: ' + refused.said);
    check(!/502|draft_quality_failed|family safety contract|Note generation/.test(refused.said),
      name + ': the refusal carries a status code, a code name or the note wording: ' + refused.said);
    check(!refused.out, name + ': a refused section still produced a report');

    /* 2. a failure that is not a refusal keeps its words */
    const offline = await draft(source, name, 3, () => new Error('Failed to fetch'));
    check(offline.said === 'Expert report section 3 could not be generated; retry the complete report.',
      name + ': a transport failure changed wording: ' + offline.said);
    const empty = await draft(source, name, 5, () => { const e = new Error('empty section response'); e.legalQualityFailure = true; return e; });
    check(empty.said === 'Expert report section 5 could not be generated; retry the complete report.',
      name + ': an empty section changed wording: ' + empty.said);

    /* 3. a section refused once and accepted on its retry finishes the report */
    const recovered = await draft(source, name, 8, (attempt) => (attempt === 1 ? refusal() : null));
    check(!recovered.said && /^EXPERT WITNESS REPORT/.test(recovered.out) && /VIII\. EXPERT OPINIONS\nThe records furnished/.test(recovered.out) && recovered.calls.length === 18,
      name + ': a section accepted on its retry did not finish the report: ' + (recovered.said || recovered.calls.length));
  }
  if (failures.length) {
    console.error('FAIL expert-report-section-refusal-says-why: ' + failures.length + ' of ' + checks + ' checks failed:\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log('PASS expert-report-section-refusal-says-why: ' + checks + ' checks across ' + SHELLS.length + ' shells - an expert report section the server\'s safety check refused on both attempts names the section and says the safety check refused it, and that a retry drafts every section again (no status code, no code name); a transport failure or an empty section keeps "could not be generated"; a section accepted on its retry still finishes the report');
})().catch((e) => { console.error(e); process.exit(1); });
