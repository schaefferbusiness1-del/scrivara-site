'use strict';
/* ONE PLACE TO ADD EVERY TEMPLATE - THE AI SPLITS AND SORTS, THE DOCTOR SEES
   WHERE EACH ONE GOES AND WHY (tplsort-1.2.0; tplsort-1.3.0, 2026-09-24).

   Owner, verbatim: "YOU SHOULD BE ABLE TO ADD templates and it should auto
   sort into the correct places" / "like one stop to add all templates that
   then all get auto sorted".

   Driven in real Chrome against the shipped 1p shell and its real modules,
   on a desktop and on a phone. /api/templates/split is the backend's own
   contract (tests/fixtures/template-split-server.js): the MODEL is scripted
   to name the line each template starts on, with "goes" and "why", and the
   server cuts the document at those lines - or it fails (5xx, 429), or an
   older server answers with text the client must refuse. Nothing leaves
   127.0.0.1.

     A. Settings' "+ Add templates" opens the one place, headed "Add
        templates", not the op-note room.
     B. an import while the doctor's own "+ Add" is pending: the new format
        stays in use, and Cancel on that row still restores the format that
        was in use before "+ Add".
     C. an open row editor with unsaved typing keeps every typed word, and the
        doctor is told where the imported template went; its Save does not
        touch the import.
     D. a mixed paste, placed exactly as the splitter says, with its reasons;
        an "unsure" row asks, with a one-tap best guess; a paste of three
        templates and a double-spaced paste of three visits become their
        pieces, each keeping its own last line; Save refuses until every row
        has a place; every letter is kind letter (kind insurance is the Insurance-ready NOTE format, which drafts visit notes), the other letter
        no kind, the op note kind op; one toast.
     E. Split into sections: parts never keep their section's own heading as a
        required heading.
     F. a batch of real files (PDF, .docx, .odt, .txt): ONE splitter call per
        file; an op report keeps its post-operative instructions; two letters
        in one .docx are two rows; a short ROS file is readable.
     G. limits: 2,000 characters and 8 formats are explained and the refused
        rows stay listed.
     H. typing one template in the Templates panel keeps the list.
     I. signed in to the cloud library: the Save button is held during the
        cloud save, kinds reach the cloud, refused rows stay in sight.
     J. an account switch empties everything staged.
     K. failures: a 5xx and a 429 keep each paste whole, say why ONCE, and
        "Try sorting again" sorts them; an answer that rewrote the text is
        kept whole, "the sorting AI's answer could not be used"; signed out
        nothing is sorted or cut.
     L. "+ Add templates" pressed from inside the op-note room returns the
        doctor to the room.
     M. phone: it fits 390px, and the Save/Discard footer never covers a
        row's "Goes to" select.
     N. round 3's blocking repros, in real Chrome (tplsort-1.3.0): an Epic
        *** paste is ONE splitter call with the whole text and no in-use
        section format becomes a bare heading; a batch of op notes with ***
        blanks is three whole op templates; a fill-in-the-blank work status
        form reads, uploaded and pasted, and is added as a letter (kind
        letter); the EMR panel's AI sort never stages a patient note. */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const assert = require('assert');
const { chromium } = require('playwright');
const SPLIT = require('./fixtures/template-split-server.js');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';

/* ---------- static: one place, one uploader, both shells in step ---------- */
for (const shell of ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')]) {
  const html = fs.readFileSync(path.join(ROOT, shell), 'utf8');
  assert.strictEqual((html.match(/<input type="file" id="tpl[A-Za-z]*"/g) || []).length, 1, shell + ': the one place grew a second template file input');
  assert.ok(html.includes('id="tplIntakePaste"') && html.includes('onclick="tplSortPasted()"') && html.includes('id="tplSortKept"'), shell + ': the paste box or the kept rows are missing from the upload card');
  assert.ok(/async function _tplSplitCall\(text\)\{/.test(html) && /async function tplAddSplitSorted\(\)\{/.test(html) && /function _tplSortVerify\(doc,list,cover\)\{/.test(html), shell + ': the splitter call, its answer check or the one Save is missing');
  assert.ok(!/function _tplSortPieces\(|function _tplDestinationFor\(|function _tplSortSeparated\(/.test(html), shell + ': a client-side cutter or placer came back');
  assert.ok(html.includes('onclick="tplAddSplitSorted()"'), shell + ': the Save button no longer carries "tplAddSplit" for the template library to find');
  assert.ok(/addEventListener\('mls:session-boundary',_tplSortSessionReset,true\)/.test(html), shell + ': the staged rows are not reset at a session boundary');
}
const DT = fs.readFileSync(path.join(ROOT, '1p-feat_mls_draft_tuning.js'), 'utf8');
assert.ok(/importVisitTemplates: importVisitTemplates/.test(DT) && DT.includes("id=\"mlsVnTplIntake\""), 'the Visit note templates card lost its Add templates door or its import');

/* ---------- fixtures (synthetic, PHI-free) ---------- */
const L = (a) => a.join('\n');
const X = {
  soap: L(['Knee follow-up visit - use after an injection', '', 'SUBJECTIVE:', 'Chief complaint: [reason for the visit]', 'History of present illness: [onset, location, duration]', '',
    'REVIEW OF SYSTEMS:', 'Constitutional: [fever, chills, weight change]', '', 'PHYSICAL EXAM:', 'General: [appearance]', 'Knee: [effusion], [range of motion]', '',
    'ASSESSMENT:', '1. [Diagnosis] - [status]', '', 'PLAN:', '- [Medication changes]', 'Follow up: [interval]']),
  hpi: L(['HISTORY OF PRESENT ILLNESS:', 'Onset: [when]', 'Location: [where]', 'Duration: [how long]', 'Severity (0-10): [ ]']),
  hpi2: L(['HISTORY OF PRESENT ILLNESS:', 'Onset: [second HPI]', 'Location: [where]', 'PAST MEDICAL HISTORY:', '[ ]', 'MEDICATIONS:', '[ ]']),
  examImpression: L(['PHYSICAL EXAM:', 'Knee: [effusion], [ROM], [ligaments stable]', '', 'IMAGING:', 'X-rays of the knee, 3 views, reviewed today.', 'Impression: [joint space narrowing]']),
  caudal: L(['PROCEDURE: Caudal epidural steroid injection.', 'PRIOR AUTHORIZATION: [#] (verified with insurance)', 'INDICATION: [DIAGNOSIS] with [SYMPTOMS] refractory to conservative care.',
    'CONSENT: Risks, benefits, and alternatives discussed; informed consent obtained.',
    'TECHNIQUE: The patient was placed prone. The sacral hiatus was identified under fluoroscopic guidance. [STEROID DOSE] was injected.',
    'COMPLICATIONS: None.', 'DISPOSITION: The patient tolerated the procedure well and was discharged in stable condition.']),
  facet: L(['PROCEDURE: Lumbar intra-articular facet joint injection at [LEVELS], [LATERALITY].', 'INDICATION: [DIAGNOSIS] consistent with facet-mediated pain.',
    'TECHNIQUE: Under fluoroscopic guidance the facet joints were injected with [STEROID DOSE].', 'COMPLICATIONS: None.', 'PLAN: Follow up in [2 weeks] to assess response.']),
  genicular: L(['PROCEDURE: Genicular nerve block, [LATERALITY] knee.', 'INDICATION: Chronic knee osteoarthritis pain.', 'TECHNIQUE: Under ultrasound guidance the genicular nerves were blocked.', 'COMPLICATIONS: None.', 'DISPOSITION: Home.']),
  lmn: L(['LETTER OF MEDICAL NECESSITY', 'To: [Insurance company]', 'Member ID: [ ]', 'Diagnosis: [ICD-10]', 'Requested treatment: [CPT] [procedure]', 'Clinical history: [ ]', 'Sincerely, [Doctor]']),
  work: L(['WORK STATUS NOTE', '[Patient] was seen in clinic today.', 'Work status: [full duty / restrictions]', 'Return to clinic: [ ]']),
  instructions: L(['POST-INJECTION INSTRUCTIONS', 'Keep the site clean and dry for 24 hours.', 'You may have increased pain for 1-2 days. Use ice.', 'Call the office for fever, redness or weakness.', 'Follow up: [interval]']),
  plain: 'Please keep this for later. It has no headings and nothing in it says where it goes, so MLS must ask.',
  threeA: L(['KNEE HPI TEMPLATE', 'HPI:', 'Onset: [ ]', 'Mechanism: [ ]']),
  threeB: L(['KNEE EXAM TEMPLATE', 'PHYSICAL EXAM:', 'Knee: [effusion]', 'Ligaments: [Lachman]']),
  threeC: L(['KNEE PLAN TEMPLATE', 'PLAN:', '- [brace]', '- [therapy]']),
  visit1: L(['NEW PATIENT - LOW BACK', 'CHIEF COMPLAINT:', '[ ]', 'HPI:', '[back story]', 'EXAM:', 'Lumbar: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', 'Physical therapy referral', 'Return in 6 weeks']),
  visit2: L(['FOLLOW UP - LOW BACK', 'INTERVAL HISTORY:', '[ ]', 'EXAM:', 'Lumbar: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', 'Continue home exercise program', 'Return as needed']),
  visit3: L(['NEW PATIENT - KNEE', 'CHIEF COMPLAINT:', '[ ]', 'HPI:', '[knee story]', 'EXAM:', 'Knee: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', 'Knee injection today', 'Return in 3 months']),
  apProblems: L(['Assessment & Plan:', '# Lumbar radiculopathy', '  Assessment: [improving / stable / worse]', '  Plan: [PT], [medication]', '# Knee osteoarthritis', '  Assessment: [ ]', '  Plan: [brace], [injection]']),
  hp: L(['CHIEF COMPLAINT:', '[in the patient words]', 'HISTORY OF PRESENT ILLNESS:', '[onset, location, duration]', 'PAST MEDICAL HISTORY:', '[ ]', 'MEDICATIONS:', '[ ]', 'ALLERGIES:', '[ ]',
    'REVIEW OF SYSTEMS:', 'Constitutional: [ ]', 'Cardiovascular: [ ]', 'PHYSICAL EXAMINATION:', 'General: [ ]', 'Lungs: [ ]', 'Heart: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', '[ ]']),
  soapLetters: L(['S:', 'Patient presents for follow up of [condition].', '', 'O:', 'Vitals: BP [ ] HR [ ]', 'Focused exam: [ ]', '', 'A/P:', '1. [Diagnosis] - [status]', '- Return in [interval]']),
  hpiNoHeading: 'Knee pain began [date] after [event]. It is worse with [stairs] and better with [rest]. Swelling: [yes/no].',
  kneeScope: L(['OPERATIVE REPORT', 'PROCEDURE: Right knee arthroscopy with partial medial meniscectomy', 'ANESTHESIA: General', 'FINDINGS: [ ]', 'COMPLICATIONS: None', '', 'POST-OPERATIVE INSTRUCTIONS', 'MEDICATIONS: [ ]', 'ACTIVITY: Weight bearing as tolerated']),
  rosShort: L(['ROS:', 'Eyes: [ ]', 'Skin: [ ]', 'Neuro: [ ]']),
  rosOdtParas: ['REVIEW OF SYSTEMS', 'Constitutional: denies fever or weight loss', 'Musculoskeletal: knee pain as in HPI', 'Neurological: denies numbness or weakness'],
  asthma: L(['ASTHMA ACTION PLAN', 'GREEN ZONE: Take your controller medicine [ ] every day.', 'YELLOW ZONE: Take your rescue inhaler [ ] puffs.', 'RED ZONE: Take your rescue inhaler and call 911.'])
};
const DOUBLE = (t) => t.split('\n').join('\n\n');
/* round 3's blocking repros (tplsort-1.3.0) */
const EPIC = L(['CHIEF COMPLAINT:', '***', 'HPI:', '***', 'ROS:', '***', 'PHYSICAL EXAM:', '***', 'ASSESSMENT/PLAN:', '***']);
const MBB = L(['PROCEDURE: Lumbar medial branch block at ***', 'INDICATION:', '***', 'TECHNIQUE:', '***', 'COMPLICATIONS:', '***', 'DISPOSITION: Home']);
const CAUDAL_SHORT = L(['PROCEDURE: Caudal epidural steroid injection', 'INDICATION: [ ]', 'TECHNIQUE: The sacral hiatus was identified under fluoroscopy.', 'COMPLICATIONS: None']);
const GENIC_SHORT = L(['PROCEDURE: Genicular nerve block, [LATERALITY] knee', 'TECHNIQUE: Under ultrasound guidance the genicular nerves were blocked.', 'COMPLICATIONS: None']);
/* 107 letters in 430 non-space characters: a form that is mostly blanks */
const WORK_FORM = L(['WORK STATUS REPORT', 'Patient: ______________________________ Date: ______________', 'Diagnosis: ________________________________________________',
  'Work status: [ ] Full duty [ ] Modified duty [ ] Off work', 'Restrictions: ________________________________________________', '________________________________________________________',
  'Lifting limit: ______ lbs   Hours per day: ______', 'Next visit: ______________', 'Physician signature: ______________________________',
  '________________________________________________________', '________________________________________________________', '________________________________________________________']);
const COVERED = L(['DR SMITH CLINIC TEMPLATES', 'Version 3', '', 'NEW PATIENT - LOW BACK', 'CHIEF COMPLAINT:', '[ ]', 'HPI:', '[back story]', 'EXAM:', 'Lumbar: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', 'Physical therapy referral', 'Return in 6 weeks']);
/* the MODEL's answers: which pieces of the document are templates, with
   goes/why - the server (SPLIT) cuts the document at each piece's first line */
const P = (text, goes, why, extra) => Object.assign({ text, goes, why }, extra || {});
const FIX = [
  [P(X.threeA, 'hpi', 'It is a knee HPI template.', { name: 'Knee HPI template' }), P(X.threeB, 'exam', 'It is a knee exam template.', { name: 'Knee exam template' }), P(X.threeC, 'plan', 'It is a knee plan template.', { name: 'Knee plan template' })],
  [P(X.visit1, 'visit', 'It has CC, HPI, Exam, Assessment and Plan headings.', { name: 'New patient - low back' }), P(X.visit2, 'visit', 'It has interval history, exam, assessment and plan.', { name: 'Follow up - low back' }), P(X.visit3, 'visit', 'It has CC, HPI, Exam, Assessment and Plan headings.', { name: 'New patient - knee' })],
  [P(X.lmn, 'letter', 'It is a letter of medical necessity to an insurer.', { insurance: true, name: 'Letter of medical necessity' }), P(X.work, 'letter', 'It is a work status note.', { name: 'Work status note' })],
  [P(X.hpi, 'hpi', 'It has only a history of present illness section.')], [P(X.hpi2, 'hpi', 'It is an HPI with past history and medications inside it.')],
  [P(X.examImpression, 'unsure', 'It is an exam with an imaging impression; it could be an exam or a note fragment.')],
  [P(X.caudal, 'op', 'It is a procedure note for a caudal epidural steroid injection.', { name: 'Caudal epidural steroid injection' })],
  [P(X.facet, 'op', 'It is a facet joint injection procedure note.')], [P(X.genicular, 'op', 'It is a genicular nerve block procedure note.')],
  [P(X.lmn, 'letter', 'It is a letter of medical necessity to an insurer.', { insurance: true })],
  [P(X.instructions, 'letter', 'It is a patient instruction handout.', { name: 'Post-injection instructions' })],
  [P(X.plain, 'unsure', '')], [P(X.soap, 'visit', 'It has Subjective, ROS, Exam, Assessment and Plan headings.')], [P(X.apProblems, 'plan', 'It is one problem-by-problem Assessment and Plan.')],
  [P(X.hp, 'visit', 'It is a full H&P.')], [P(X.soapLetters, 'visit', 'It is an S/O/A/P note.')], [P(X.hpiNoHeading, 'unsure', 'It reads like a history but has no headings.')],
  [P(X.kneeScope, 'op', 'It is an operative report with its post-operative instructions.', { name: 'Right knee arthroscopy' })], [P(X.rosShort, 'ros', 'It is a short review of systems.')],
  [P(X.asthma, 'letter', 'It is a patient handout.')],
  [P(L(['Review of Systems', 'Constitutional: denies fever, chills', 'IMPORTED ROS MARKER: [ ]']), 'ros', 'It is a review of systems.')],
  [P(X.rosOdtParas.join('\n'), 'ros', 'It is a review of systems.')]
];
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/* The model: the FIX entry this document is made of, as start lines; a
   document it does not know is one template it is unsure of. */
function modelOf(text) {
  const n = norm(text);
  for (const pieces of FIX) {
    if (!pieces.every((p) => n.includes(norm(p.text)))) continue;
    const size = pieces.reduce((a, p) => a + norm(p.text).length, 0);
    if (size < n.length * 0.9) continue;
    const ordered = pieces.slice().sort((a, b) => n.indexOf(norm(a.text)) - n.indexOf(norm(b.text)));
    if (ordered.length === 1) return () => ({ templates: [{ start: 1, name: ordered[0].name || '', goes: ordered[0].goes, why: ordered[0].why || '', insurance: !!ordered[0].insurance }] });
    return SPLIT.modelFor(ordered);
  }
  return () => ({ templates: [{ start: 1, goes: 'unsure', why: '' }] });
}
/* The server: the backend's cut of the model's answer. */
function scripted(text) { return SPLIT.respond(text, modelOf(text)).body; }

/* A real OpenDocument text file, and a real .docx: zips whose words live in content.xml / word/document.xml. */
function crc32(buf) { let crc = 0xFFFFFFFF; for (let n = 0; n < buf.length; n++) { let c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function zip(entries) {
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), raw = Buffer.from(e.data, 'utf8'), comp = e.store ? raw : zlib.deflateRawSync(raw), method = e.store ? 0 : 8, crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); centrals.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(locals.concat([cd, end]));
}
const xe = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function odt(paragraphs) {
  const body = paragraphs.map((p, i) => i === 0 ? '<text:h text:outline-level="1">' + xe(p) + '</text:h>' : '<text:p>' + xe(p).replace(': ', ':<text:s/>') + '</text:p>').join('');
  const content = '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text>' + body + '</office:text></office:body></office:document-content>';
  return zip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true }, { name: 'styles.xml', data: '<?xml version="1.0"?><x>STYLE JUNK THAT IS NOT THE DOCUMENT</x>' }, { name: 'content.xml', data: content }]);
}
function docx(lines) {
  const body = lines.map((l) => '<w:p><w:r><w:t xml:space="preserve">' + xe(l) + '</w:t></w:r></w:p>').join('');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>' }]);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-tplsort3-'));
const F = (n) => path.join(TMP, n);
fs.writeFileSync(F('caudal-esi.txt'), X.caudal); fs.writeFileSync(F('lumbar-facet-injection.txt'), X.facet); fs.writeFileSync(F('genicular-nerve-block.txt'), X.genicular);
fs.writeFileSync(F('knee-ros.odt'), odt(X.rosOdtParas)); fs.writeFileSync(F('Visit templates.docx'), docx([X.visit1, X.visit2, X.visit3].join('\n').split('\n')));
fs.writeFileSync(F('follow-up-visit.txt'), X.soapLetters); fs.writeFileSync(F('hpi-knee.txt'), X.hpiNoHeading); fs.writeFileSync(F('Letters.docx'), docx((X.lmn + '\n' + X.work).split('\n')));
fs.writeFileSync(F('knee-arthroscopy.txt'), X.kneeScope); fs.writeFileSync(F('ros-short.txt'), X.rosShort);
fs.writeFileSync(F('caudal.txt'), CAUDAL_SHORT); fs.writeFileSync(F('genicular.txt'), GENIC_SHORT); fs.writeFileSync(F('mbb.txt'), MBB); fs.writeFileSync(F('work-status.txt'), WORK_FORM);

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const server = { split: [], preview: [], commit: [], device: [], park: false, hold: null, mode: 'ok', cloud: false, rewrite: false, model: null };
  const boot = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    /* a loaded machine (the full suite runs browsers side by side) is slow, not broken */
    pg.setDefaultTimeout(60000);
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const u = new URL(route.request().url());
      const json = (o, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (u.pathname === '/api/templates/split') {
        server.split.push(String(body.text || ''));
        if (server.mode === '500') return json({ error: 'Could not split the document.' }, 502);
        if (server.mode === '429') return json({ error: 'Too many requests' }, 429);
        if (server.model) return json(SPLIT.respond(String(body.text || ''), server.model).body);
        const answer = scripted(String(body.text || ''));
        /* an OLDER server: the model's copy of each template's text, no start line */
        if (server.rewrite) answer.templates = answer.templates.map((t) => ({ name: t.name, goes: t.goes, why: t.why, text: t.text.replace(/\[ \]/g, '[blank]') }));
        return json(answer);
      }
      if (u.pathname === '/api/template-sets') {
        if (!server.cloud) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return json({ activeSetId: server.commit.length ? 'set-1' : '', sets: server.commit.length ? [{ id: 'set-1', name: 'Imported templates', active: true, version: 1, templateCount: 1, scope: 'account' }] : [] });
      }
      if (u.pathname === '/api/template-imports/preview') {
        server.preview.push(body);
        if (server.hold) await server.hold();
        const n = (body.templates || []).length, rej = server.park ? 1 : 0;
        return json({ preview: { counts: { added: n - rej, updated: 0, duplicated: 0, rejected: rej, unchanged: 0, removed: 0 }, canCommit: true, proposedTemplateCount: n, targetSetId: null, detail: { rejected: rej ? [{ index: 0, name: 'x', reason: 'needs a look' }] : [] } } });
      }
      if (u.pathname === '/api/template-imports/commit') {
        server.commit.push(body);
        const incoming = (body.templates || []).map((t, i) => Object.assign({}, t, { id: 'cloud-' + server.commit.length + '-' + i }));
        return json({ result: { status: 'complete', version: 1, counts: { added: incoming.length, updated: 0, duplicated: 0, rejected: 0, unchanged: 0, removed: 0 },
          set: { id: 'set-1', name: 'Imported templates', active: true, version: 1, scope: 'account', templates: server.device.concat(incoming) } } });
      }
      return route.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
      try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
    });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.evaluate(async () => {
      await window.__mlsEnsureDraftTuning();
      if (!window.__mlsTemplateLibrary && !document.querySelector('script[data-mls-asset="feat_mls_template_library.js"]')) {
        const s = document.createElement('script'); s.src = 'feat_mls_template_library.js'; s.setAttribute('data-mls-asset', 'feat_mls_template_library.js'); document.body.appendChild(s);
      }
    });
    await pg.waitForFunction(() => !!(window.__mlsDraftTuning && window.__mlsDraftTuning.installed && window.__mlsTemplateLibrary && window.__mlsTemplateLibrary.installed), null, { timeout: 60000 });
    await pg.evaluate(() => { window.__toasts = []; const t = window.toast; window.toast = function (m, k) { window.__toasts.push(String(m)); return typeof t === 'function' ? t.apply(this, arguments) : undefined; }; });
    await pg.waitForTimeout(500);
    return pg;
  };
  const signIn = (pg) => pg.evaluate(() => { sessionStorage.setItem('sf_bk_token', 'synthetic-test-token'); });
  const state = (pg) => pg.evaluate(() => {
    const fam = window.__mlsDraftTuning.read().families || {};
    const out = { families: {}, ops: getTemplates().map(t => ({ id: t.id, name: t.name, kind: t.kind || '', kindSuggested: !!t.kindSuggested, text: String(t.text || t.body || '') })) };
    ['soap', 'hpi', 'ros', 'exam', 'assessment', 'plan'].forEach(f => {
      const x = fam[f] || { profiles: [] };
      out.families[f] = { active: x.activeProfile || '', profiles: (x.profiles || []).map(p => ({ id: p.id, label: p.label, text: p.templateText || '', mode: p.templateMode })) };
    });
    return out;
  });
  const rows = (pg) => pg.evaluate(() => Array.from(document.querySelectorAll('#tplMultiResult .tpl-sort-row'), r => ({
    dest: r.getAttribute('data-tpl-dest'), guess: r.getAttribute('data-tpl-guess') || '', name: (r.querySelector('.tpl-sort-name') || {}).textContent || '',
    why: (r.querySelector('.tpl-sort-why') || {}).textContent || '', warn: (r.querySelector('.tpl-sort-warn') || {}).textContent || '', cover: (r.querySelector('.tpl-sort-cover') || {}).textContent || '',
    from: (r.querySelector('.tpl-sort-from') || {}).textContent || '', split: !!r.querySelector('.tpl-sort-split'), use: (r.querySelector('.tpl-sort-use') || {}).textContent || '' })));
  const pending = (pg) => pg.evaluate(() => _tplPendingSplit.map(t => ({ dest: t.dest, guess: t.guess, name: t.name, text: t.text, libKind: t.libKind || '' })));
  const paste = async (pg, text) => {
    const n = await pg.evaluate(() => _tplPendingSplit.length);
    await pg.evaluate(() => { const d = document.getElementById('tplIntakePasteWrap'); if (d) d.open = true; });
    await pg.fill('#tplIntakePaste', text);
    await pg.click('#tplIntakeSortBtn');
    await pg.waitForFunction(k => _tplPendingSplit.length > k && document.querySelectorAll('#tplMultiResult .tpl-sort-row').length > k, n, { timeout: 60000 });
  };
  const save = async (pg) => {
    await pg.evaluate(() => { window.__toasts = []; });
    await pg.click('#tplSortSaveBtn');
    await pg.waitForFunction(() => /^(Saved|Nothing was saved)/.test(document.getElementById('tplMultiStatus').textContent), null, { timeout: 60000 });
    await pg.waitForTimeout(300);
    return pg.textContent('#tplMultiStatus');
  };
  const activeOf = (st, f) => st.families[f].profiles.find(p => p.id === st.families[f].active) || {};
  const intake = async (pg) => {
    await pg.evaluate(() => openVisitNoteTemplates());
    await pg.waitForSelector('#mlsVnTplIntake', { state: 'visible', timeout: 45000 });
    await pg.click('#mlsVnTplIntake');
    await pg.waitForSelector('#tplIntakePaste', { state: 'visible', timeout: 45000 });
  };
  const back = async (pg) => {
    await pg.click('.tpl-sort-done button');
    await pg.waitForFunction(() => !document.getElementById('templatesModal').classList.contains('show') && document.getElementById('settingsModal').classList.contains('show'), null, { timeout: 45000 });
    await pg.waitForTimeout(300);
  };
  const required = (pg, family, text) => pg.evaluate(([f, t]) => _mlsRequiredTemplateHeadings({ templateMode: 'adapt', templateText: t }, f), [family, text]);
  try {
    const pg = await boot({ viewport: { width: 1400, height: 900 } });
    await signIn(pg);

    /* ===== A + B. Settings' "+ Add templates" - and the doctor's own "+ Add" in progress ===== */
    const own = await pg.evaluate(() => { const ed = window.__mlsDraftTuning.profileEditor('hpi'); const s = ed.add({ label: 'Standard HPI', templateText: 'STANDARD HPI - the doctor\'s own' }); return String(s.id); });
    await pg.evaluate(() => openVisitNoteTemplates());
    await pg.waitForSelector('#mlsVnTplAdd_hpi', { state: 'visible', timeout: 45000 });
    await pg.click('#mlsVnTplAdd_hpi');
    const pendAdd = await pg.evaluate(() => { const f = window.__mlsDraftTuning.read().families.hpi; return { active: f.activeProfile, label: (f.profiles.find(p => p.id === f.activeProfile) || {}).label, open: document.getElementById('mlsVnTplEditor_hpi').getAttribute('data-open') }; });
    assert.ok(/New HPI format/.test(pendAdd.label) && pendAdd.open === '1' && pendAdd.active !== own, 'the "+ Add" setup did not put a new HPI format in use: ' + JSON.stringify(pendAdd));
    await pg.click('#mlsVnTplIntake');
    await pg.waitForSelector('#tplIntakePaste', { state: 'visible', timeout: 45000 });
    const door = await pg.evaluate(() => {
      const tm = document.getElementById('templatesModal'), r = document.getElementById('tplIntakeCard').getBoundingClientRect();
      return { shown: tm.classList.contains('show'), intake: tm.classList.contains('tpl-intake'), room: document.getElementById('opPrepModal').classList.contains('show'),
        heading: tm.querySelector('h3').innerText.trim(), note: (tm.querySelector('p.tpl-ctx-intake') || {}).innerText || '', text: tm.innerText, inView: r.top >= 0 && r.top < innerHeight - 100 };
    });
    assert.ok(door.shown && door.intake && !door.room && door.inView, 'Add templates did not open the one place over Settings: ' + JSON.stringify(door));
    assert.strictEqual(door.heading, '📥 Add templates', 'the one place is not headed "Add templates": ' + door.heading);
    assert.ok(/visit note templates/.test(door.note) && /operative/.test(door.note) && /letters/.test(door.note), 'the copy does not cover visit and operative templates: ' + door.note);
    assert.ok(!/Prep op notes|Op notes —|Op-note templates/.test(door.text), 'reached from Settings, the one place reads as the op-note room');
    await pg.waitForTimeout(1500);
    const stays = await pg.evaluate(() => ({ room: !!(window.__mlsOpNoteRoom && window.__mlsOpNoteRoom.installed), roomOpen: document.getElementById('opPrepModal').classList.contains('show'),
      shown: document.getElementById('templatesModal').classList.contains('show'), intake: document.getElementById('templatesModal').classList.contains('tpl-intake'), inRoom: document.getElementById('templatesModal').parentElement.id === 'oprPanelTpls' }));
    assert.deepStrictEqual(stays, { room: true, roomOpen: false, shown: true, intake: true, inRoom: false }, 'the op-note room took over the one place after it opened: ' + JSON.stringify(stays));

    let calls = server.split.length;
    await paste(pg, X.hpi);
    assert.strictEqual(server.split.length, calls + 1, 'the paste did not go to the splitter exactly once');
    let list = await rows(pg);
    assert.deepStrictEqual([list[0].dest, list[0].why], ['hpi', 'It has only a history of present illness section.'], 'the row is not placed with the splitter\'s answer: ' + JSON.stringify(list[0]));
    assert.strictEqual(list[0].name, 'History of present illness', 'a pasted template was not named by its own heading: ' + list[0].name);
    const saidB = await save(pg);
    assert.strictEqual(saidB, 'Saved 1 to HPI.', saidB);
    const doneB = await pg.evaluate(() => (document.querySelector('.tpl-sort-done') || {}).innerText || '');
    assert.match(doneB, /HPI: your current format “New HPI format” stays in use\./, 'the doctor\'s own "+ Add" was taken over: ' + doneB);
    const afterB = await state(pg);
    assert.strictEqual(afterB.families.hpi.active, pendAdd.active, 'the import took over from the doctor\'s own new format');
    const importedHpi = afterB.families.hpi.profiles.find(p => p.text.startsWith('Onset: [when]'));
    assert.ok(importedHpi, 'the HPI template was not saved - or kept its own "HISTORY OF PRESENT ILLNESS:" heading: ' + JSON.stringify(afterB.families.hpi.profiles.map(p => p.text.slice(0, 40))));
    await back(pg);
    await pg.evaluate(() => document.getElementById('mlsVnTplCancel_hpi').click());
    await pg.waitForTimeout(300);
    const afterCancel = await state(pg);
    assert.strictEqual(afterCancel.families.hpi.active, own, 'Cancel on the row no longer restores the format that was in use before "+ Add": ' + afterCancel.families.hpi.active);
    assert.ok(!afterCancel.families.hpi.profiles.some(p => p.id === pendAdd.active), 'Cancel did not take the empty new format back out');
    assert.ok(afterCancel.families.hpi.profiles.some(p => p.id === importedHpi.id), 'Cancel removed the imported template');

    /* ===== C. an open editor with unsaved typing keeps every word ===== */
    await pg.click('#mlsVnTplOpen_ros');
    await pg.fill('#mlsVnTplText_ros', 'UNSAVED ROS TYPING: [ ]');
    const rosActiveBefore = (await state(pg)).families.ros.active;
    await pg.click('#mlsVnTplIntake');
    await pg.waitForSelector('#tplIntakePaste', { state: 'visible', timeout: 45000 });
    await paste(pg, 'Review of Systems\nConstitutional: denies fever, chills\nIMPORTED ROS MARKER: [ ]');
    assert.strictEqual(await save(pg), 'Saved 1 to ROS.');
    assert.match(await pg.innerText('.tpl-sort-done'), /ROS: you have unsaved typing in its editor in Settings, so it was left open/, 'the doctor is not told the typing was kept');
    const afterC = await state(pg);
    assert.strictEqual(afterC.families.ros.active, rosActiveBefore, 'the import changed the ROS format in use under unsaved typing');
    assert.ok(afterC.families.ros.profiles.some(p => /IMPORTED ROS MARKER/.test(p.text)), 'the imported ROS was not saved');
    await back(pg);
    const rosEditor = await pg.evaluate(() => ({ open: document.getElementById('mlsVnTplEditor_ros').getAttribute('data-open'), typed: document.getElementById('mlsVnTplText_ros').value, status: document.getElementById('mlsVnTplStatus').textContent }));
    assert.deepStrictEqual([rosEditor.open, rosEditor.typed], ['1', 'UNSAVED ROS TYPING: [ ]'], 'the unsaved typing was discarded: ' + JSON.stringify(rosEditor));
    assert.match(rosEditor.status, /Your unsaved typing in ROS is still in its editor/, 'the row does not say where the import went: ' + rosEditor.status);
    await pg.click('#mlsVnTplSave_ros');
    await pg.waitForTimeout(300);
    const afterC2 = await state(pg);
    assert.ok(afterC2.families.ros.profiles.some(p => /IMPORTED ROS MARKER/.test(p.text)) && afterC2.families.ros.profiles.some(p => /UNSAVED ROS TYPING/.test(p.text)), 'the row editor overwrote the imported ROS template');

    /* ===== D. a mixed paste, placed exactly as the splitter says ===== */
    await pg.click('#mlsVnTplIntake');
    await pg.waitForSelector('#tplIntakePaste', { state: 'visible', timeout: 45000 });
    const beforeD = await state(pg);
    calls = server.split.length;
    for (const t of [X.hpi2, X.examImpression, X.caudal, X.lmn, X.instructions, X.plain]) await paste(pg, t);
    await paste(pg, [X.threeA, X.threeB, X.threeC].join('\n\n'));
    await paste(pg, DOUBLE([X.visit1, X.visit2, X.visit3].join('\n')));
    assert.strictEqual(server.split.length, calls + 8, 'not exactly one splitter call per paste');
    list = await rows(pg);
    assert.deepStrictEqual(list.map(r => r.dest), ['hpi', 'choose', 'op', 'letters', 'letters', 'choose', 'hpi', 'exam', 'plan', 'soap', 'soap', 'soap'], 'the rows are not the splitter\'s answer: ' + JSON.stringify(list.map(r => [r.name, r.dest, r.guess])));
    assert.strictEqual(list[1].guess, 'exam', 'the unsure exam has no best guess');
    assert.match(list[1].why, /^It is an exam with an imaging impression; it could be an exam or a note fragment\. MLS is not sure where it goes\. Choose where it goes\. Best guess: Exam/, list[1].why);
    assert.strictEqual(list[1].use, 'Put it in Exam');
    assert.strictEqual(list[2].why, 'It is a procedure note for a caudal epidural steroid injection.');
    assert.strictEqual(list[2].name, 'Caudal epidural steroid injection');
    assert.strictEqual(list[5].guess, '', 'a headingless template was given a guess');
    assert.ok(list.slice(6, 9).every(r => /Template \d of 3 from your paste/.test(r.from)), 'the three templates in one paste do not say where they came from');
    const dbl = await pending(pg);
    assert.deepStrictEqual(dbl.slice(9).map(r => r.text.replace(/\n\n/g, '\n')), [X.visit1, X.visit2, X.visit3], 'a double-spaced paste moved a template\'s last line into the next one');
    assert.deepStrictEqual(list.slice(9).map(r => r.name), ['New patient - low back', 'Follow up - low back', 'New patient - knee']);
    assert.match(await pg.textContent('#tplMultiResult .tpl-sort-head'), /Waiting for you to choose: 2/);
    assert.match(await pg.innerText('#tplMultiResult'), /Your paste held 3 templates - each one is its own row below\./);
    /* Save refuses while one has no place - and stores nothing */
    await pg.click('#tplSortSaveBtn');
    await pg.waitForFunction(() => /still need a place/.test(document.getElementById('tplMultiStatus').textContent));
    assert.deepStrictEqual(await state(pg), beforeD, 'Save stored something while a template still had no place');
    await pg.click('#tplMultiResult .tpl-sort-row[data-tpl-row="1"] .tpl-sort-use');
    await pg.selectOption('#tplSortDest_5', 'skip');
    await pg.click('#tplMultiResult .tpl-sort-row[data-tpl-row="0"] .tpl-sort-full summary');
    const fullHpi = await pg.evaluate(() => document.querySelector('#tplMultiResult .tpl-sort-row[data-tpl-row="0"] .tpl-sort-text').textContent);
    assert.ok(/^Onset: \[second HPI\]/.test(fullHpi) && !/HISTORY OF PRESENT ILLNESS/.test(fullHpi), 'the full text does not show what will be saved: ' + JSON.stringify(fullHpi));
    const saidD = await save(pg);
    assert.strictEqual(saidD, 'Saved 3 to Whole visit note / SOAP, 2 to HPI, 2 to Exam, 1 to Plan, 1 operative note template and 2 letters or other documents. Skipped 1.', saidD);
    assert.deepStrictEqual(await pg.evaluate(() => window.__toasts.slice()), [saidD], 'the Save did not end in exactly one summary toast');
    const afterD = await state(pg);
    const hpiSaved = afterD.families.hpi.profiles.find(p => p.text.startsWith('Onset: [second HPI]'));
    assert.ok(hpiSaved, 'the HPI was not saved without its own heading');
    assert.deepStrictEqual(await required(pg, 'hpi', hpiSaved.text), ['ONSET', 'LOCATION', 'PAST MEDICAL HISTORY', 'MEDICATIONS'], 'the HPI\'s own heading became a required inner heading');
    assert.ok(afterD.families.soap.profiles.some(p => /Return in 6 weeks$/.test(p.text.replace(/\n\n/g, '\n'))), 'the first visit template lost its last line');
    const libD = afterD.ops.filter(t => !beforeD.ops.some(o => o.id === t.id));
    assert.strictEqual(libD.length, 3, 'the library did not get exactly the op note and the two letters: ' + JSON.stringify(libD.map(t => t.name)));
    const byText = (m) => libD.find(t => t.text.includes(m)) || {};
    assert.strictEqual(byText('Caudal epidural').kind, 'op', 'the op note (which mentions PRIOR AUTHORIZATION) is not kind op');
    assert.strictEqual(byText('MEDICAL NECESSITY').kind, 'letter', 'a letter to an insurer must be kind letter, never the drafting kind insurance');
    /* tplsort-1.3.0: a letter or handout is kind letter - no picker offers it (round 3's consent form out-ranked the ESI op template) */
    assert.strictEqual(byText('POST-INJECTION').kind, 'letter', 'the patient handout is not kind letter');
    for (const f of ['soap', 'hpi', 'ros', 'exam', 'assessment', 'plan']) assert.ok(!afterD.families[f].profiles.some(p => /MEDICAL NECESSITY|POST-INJECTION|Caudal epidural/.test(p.text)), 'a library template landed in the visit section ' + f);

    /* ===== E. Split into sections: no part keeps its own heading as a required one ===== */
    await paste(pg, X.hp);
    await paste(pg, X.apProblems);
    list = await rows(pg);
    assert.deepStrictEqual(list.map(r => [r.dest, r.split]), [['soap', true], ['plan', false]], 'split is offered on the wrong rows: ' + JSON.stringify(list));
    await pg.click('#tplMultiResult .tpl-sort-row[data-tpl-row="0"] .tpl-sort-split');
    await pg.waitForFunction(() => document.querySelectorAll('#tplMultiResult .tpl-sort-row').length === 6);
    const parts = await pending(pg);
    assert.deepStrictEqual(parts.map(p => p.dest), ['hpi', 'ros', 'exam', 'assessment', 'plan', 'plan']);
    const saidE = await save(pg);
    assert.strictEqual(saidE, 'Saved 1 to HPI, 1 to ROS, 1 to Exam, 1 to Assessment and 2 to Plan.', saidE);
    const afterE = await state(pg);
    const own3 = { hpi: /HISTORY OF PRESENT ILLNESS/, ros: /REVIEW OF SYSTEMS/, exam: /PHYSICAL EXAM/, assessment: /^ASSESSMENT$/, plan: /^PLAN$|ASSESSMENT & PLAN/ };
    for (const f of ['hpi', 'ros', 'exam', 'assessment', 'plan']) {
      const newest = afterE.families[f].profiles.filter(p => !afterD.families[f].profiles.some(o => o.id === p.id));
      assert.ok(newest.length, 'no new ' + f + ' format from the split');
      for (const p of newest) {
        const req = await required(pg, f, p.text);
        assert.ok(!req.some(h => own3[f].test(h)), 'the ' + f + ' part keeps its own heading as a required inner heading: ' + JSON.stringify(req));
      }
    }
    assert.ok(afterE.families.plan.profiles.some(p => /# Lumbar radiculopathy[\s\S]*Plan: \[PT\][\s\S]*# Knee osteoarthritis/.test(p.text)), 'the problem-oriented A&P was not saved whole with its inner Plan: lines');

    /* ===== F. a batch of real files - one splitter call each ===== */
    const pdfPage = await (await b.newContext()).newPage();
    await pdfPage.setContent('<html><body style="font-family:Arial;font-size:12pt">' + X.hp.split('\n').map(l => '<p style="margin:0 0 4px">' + xe(l) + '</p>').join('') + '</body></html>');
    await pdfPage.pdf({ path: F('Office visit H&P.pdf'), format: 'Letter' });
    await pdfPage.close();
    /* room for the batch: the Whole visit note section keeps at most 8 saved formats */
    await pg.evaluate(() => { const ed = window.__mlsDraftTuning.profileEditor('soap'); ed.list().slice(2).forEach(p => ed.remove(p.id)); });
    const beforeF = await state(pg);
    calls = server.split.length;
    const batch = ['Office visit H&P.pdf', 'caudal-esi.txt', 'lumbar-facet-injection.txt', 'genicular-nerve-block.txt', 'knee-ros.odt', 'Visit templates.docx', 'follow-up-visit.txt', 'hpi-knee.txt', 'Letters.docx', 'knee-arthroscopy.txt', 'ros-short.txt'];
    await pg.setInputFiles('#tplMultiFileInput', batch.map(F));
    await pg.waitForFunction(() => document.querySelectorAll('#tplMultiResult .tpl-sort-row').length >= 14 && /Check where each one is going/.test(document.getElementById('tplMultiStatus').textContent), null, { timeout: 90000 });
    assert.strictEqual(server.split.length, calls + batch.length, 'not exactly one splitter call per file: ' + (server.split.length - calls));
    list = await rows(pg);
    const got = list.map(r => r.dest + (r.guess ? ':' + r.guess : ''));
    assert.deepStrictEqual(got, ['soap', 'op', 'op', 'op', 'ros', 'soap', 'soap', 'soap', 'soap', 'choose:hpi', 'letters', 'letters', 'op', 'ros'], 'the uploaded batch is not the splitter\'s answer: ' + JSON.stringify(list.map(r => [r.name, r.dest, r.guess, r.why.slice(0, 60)])));
    assert.match(list[9].why, /Best guess: HPI - its file name “hpi-knee” suggests it/);
    assert.match(await pg.innerText('#tplMultiResult'), /“Visit templates” held 3 templates/);
    assert.match(await pg.innerText('#tplMultiResult'), /“Letters” held 2 templates/);
    const fp = await pending(pg);
    assert.ok(/^CHIEF COMPLAINT:\n/.test(fp[0].text) && fp[0].text.split('\n').length >= 15, 'the PDF text lost its lines: ' + JSON.stringify(fp[0].text.slice(0, 120)));
    assert.ok(/^REVIEW OF SYSTEMS\nConstitutional: denies fever/.test(fp[4].text) && !/content\.xml|STYLE JUNK|PK/.test(fp[4].text), 'the .odt was not read properly');
    assert.ok(/POST-OPERATIVE INSTRUCTIONS\nMEDICATIONS: \[ \]\nACTIVITY/.test(fp[12].text), 'the op report lost its post-operative instructions: ' + JSON.stringify(fp[12].text));
    assert.deepStrictEqual([fp[10].libKind, fp[11].libKind], ['', ''], 'a letter got a drafting kind');
    await pg.click('#tplMultiResult .tpl-sort-row[data-tpl-row="9"] .tpl-sort-use');
    const saidF = await save(pg);
    assert.strictEqual(saidF, 'Saved 5 to Whole visit note / SOAP, 1 to HPI, 2 to ROS, 4 operative note templates and 2 letters or other documents.', saidF);
    const afterF = await state(pg);
    const libF = afterF.ops.filter(t => !beforeF.ops.some(o => o.id === t.id));
    assert.deepStrictEqual(libF.map(t => t.kind).sort(), ['letter', 'letter', 'op', 'op', 'op', 'op'], 'the op notes and letters did not reach the library with their kinds: ' + JSON.stringify(libF.map(t => [t.name, t.kind])));
    assert.ok(libF.some(t => /PLAN: Follow up in \[2 weeks\]/.test(t.text) && t.kind === 'op'), 'the op note with a Plan line went anywhere but the op-note library');
    assert.ok(libF.some(t => /^Right knee arthroscopy/.test(t.name) && /POST-OPERATIVE INSTRUCTIONS/.test(t.text)), 'the op report was saved without its instructions, or not by its own name');
    assert.strictEqual(afterF.families.plan.profiles.length, afterE.families.plan.profiles.length, 'something landed in Plan from a procedure note');

    /* ===== G. limits are explained, and the refused rows stay listed ===== */
    await pg.evaluate(() => { const ed = window.__mlsDraftTuning.profileEditor('exam'); for (let n = 1; ed.list().length < 8; n++) ed.add({ label: 'Older exam ' + n, templateText: 'EXAM FILLER ' + n }, { activate: false }); });
    const longHpi = 'HISTORY OF PRESENT ILLNESS:\n' + Array.from({ length: 80 }, (_, i) => 'Detail ' + (i + 1) + ': [what the patient said]').join('\n');
    FIX.push([P(longHpi, 'hpi', 'It is a long HPI.')], [P('PHYSICAL EXAM:\nGait: [description]\nBalance: [Romberg]', 'exam', 'It is an exam.')], [P('ASSESSMENT:\n1. [Diagnosis]\n2. [Second diagnosis]', 'assessment', 'It is an assessment.')]);
    await paste(pg, longHpi);
    await paste(pg, 'PHYSICAL EXAM:\nGait: [description]\nBalance: [Romberg]');
    await paste(pg, 'ASSESSMENT:\n1. [Diagnosis]\n2. [Second diagnosis]');
    list = await rows(pg);
    assert.match(list[0].warn, /Too long for a visit note template: 2,\d{3} characters/, list[0].warn);
    assert.match(list[1].warn, /Exam already has 8 saved formats/, list[1].warn);
    assert.strictEqual(list[2].warn, '');
    const saidG = await save(pg);
    assert.strictEqual(saidG, 'Saved 1 to Assessment. 2 could not be saved - they are still here with the reason.', saidG);
    list = await rows(pg);
    assert.strictEqual(list.length, 2, 'the refused templates did not stay on the list');

    /* ===== H. typing one template in the Templates panel keeps the sorted list ===== */
    await pg.evaluate(() => { window.openTemplates(); });
    await pg.waitForSelector('#tplName', { state: 'visible', timeout: 45000 });
    await pg.fill('#tplName', 'Typed caudal note');
    await pg.fill('#tplText', 'PROCEDURE: Caudal epidural steroid injection\nANESTHESIA: Local\nDISPOSITION: Home.');
    await pg.click('#templatesModal button[onclick="saveTemplateFromForm()"]');
    await pg.waitForFunction(() => getTemplates().some(t => t.name === 'Typed caudal note'));
    assert.strictEqual(await pg.evaluate(() => _tplPendingSplit.length), 2, 'saving one typed template emptied the sorted list behind it');
    await pg.evaluate(() => { try { closeOpPrep(); } catch (e) {} try { closeTemplates(); } catch (e) {} });

    /* ===== K. failures keep each paste whole, say why ONCE, and can be sorted again ===== */
    await pg.evaluate(() => { _tplDiscardSplit(); window.openTemplateIntake(); });
    await pg.waitForSelector('#tplIntakePaste', { state: 'visible', timeout: 45000 });
    server.mode = '500';
    await paste(pg, X.asthma);
    server.mode = '429';
    await paste(pg, [X.threeA, X.threeB, X.threeC].join('\n\n'));
    list = await rows(pg);
    assert.deepStrictEqual(list.map(r => [r.dest, r.guess]), [['choose', 'letters'], ['choose', 'soap']], 'a failed sort placed, cut or lost a paste: ' + JSON.stringify(list));
    assert.deepStrictEqual((await pending(pg)).map(r => r.text), [X.asthma, [X.threeA, X.threeB, X.threeC].join('\n\n')]);
    const unsorted = await pg.$$eval('#tplMultiResult .tpl-sort-unsorted', els => els.map(e => e.innerText));
    assert.strictEqual(unsorted.length, 1, 'the reason is not said exactly once: ' + JSON.stringify(unsorted));
    assert.match(unsorted[0], /MLS could not sort 2 of these: (MLS did not answer; MLS was busy|MLS was busy \(too many sorts in one minute\); MLS did not answer)/, unsorted[0]);
    server.mode = 'ok';
    await pg.click('#tplMultiResult .tpl-sort-retry');
    await pg.waitForFunction(() => document.querySelectorAll('#tplMultiResult .tpl-sort-row').length === 4, null, { timeout: 60000 });
    list = await rows(pg);
    assert.deepStrictEqual(list.map(r => r.dest), ['letters', 'hpi', 'exam', 'plan'], 'Try sorting again did not sort them: ' + JSON.stringify(list));
    assert.strictEqual(await pg.$$eval('#tplMultiResult .tpl-sort-unsorted', els => els.length), 0);
    /* "Keep it as one template" puts the paste back whole */
    await pg.click('#tplMultiResult .tpl-sort-together');
    list = await rows(pg);
    assert.deepStrictEqual(list.map(r => r.dest), ['letters', 'choose'], 'Keep it as one template did not put the paste back whole');
    /* an answer that rewrote the text (an older server) is kept whole, and said truly - once */
    server.rewrite = true;
    await paste(pg, X.kneeScope);
    server.rewrite = false;
    list = await rows(pg);
    assert.strictEqual(list[2].dest, 'choose', JSON.stringify(list[2]));
    assert.strictEqual((await pending(pg))[2].text, X.kneeScope);
    const badLine = await pg.$$eval('#tplMultiResult .tpl-sort-unsorted', els => els.map(e => e.innerText));
    assert.ok(badLine.length === 1 && /MLS could not sort one of these: the sorting AI's answer could not be used\. It is kept whole/.test(badLine[0]) && /Try sorting again/.test(badLine[0]), 'the rewritten answer is not said truly: ' + JSON.stringify(badLine));
    assert.ok(!/could not split it without changing your text/.test(await pg.innerText('#tplMultiResult')), 'the old refusal line is still said');
    /* signed out: nothing is sent, cut or placed */
    await pg.evaluate(() => { _tplDiscardSplit(); sessionStorage.removeItem('sf_bk_token'); });
    calls = server.split.length;
    await paste(pg, DOUBLE([X.visit1, X.visit2, X.visit3].join('\n')));
    await paste(pg, X.kneeScope);
    list = await rows(pg);
    assert.strictEqual(server.split.length, calls, 'signed out, a template was sent to the splitter');
    assert.deepStrictEqual(list.map(r => r.dest), ['choose', 'choose'], 'signed out, a template was cut or placed');
    assert.match(await pg.innerText('#tplMultiResult .tpl-sort-unsorted'), /you are not signed in/);
    await signIn(pg);

    /* ===== L. "+ Add templates" from inside the op-note room returns to the room ===== */
    await pg.evaluate(() => { _tplDiscardSplit(); try { closeTemplates(); } catch (e) {} try { closeSettings(); } catch (e) { document.getElementById('settingsModal').classList.remove('show'); } });
    await pg.evaluate(() => window.openTemplates());
    await pg.waitForFunction(() => document.getElementById('opPrepModal').classList.contains('show') && document.getElementById('templatesModal').parentElement.id === 'oprPanelTpls', null, { timeout: 45000 });
    await pg.evaluate(() => openVisitNoteTemplates());
    await pg.waitForFunction(() => !!document.getElementById('mlsVnTplIntake'), null, { timeout: 45000 });
    /* Settings opened from the room sits in the room's stack; the button is
       pressed the way the reviewer's probe pressed it */
    await pg.evaluate(() => document.getElementById('mlsVnTplIntake').click());
    await pg.waitForFunction(() => document.getElementById('templatesModal').classList.contains('tpl-intake') && document.getElementById('templatesModal').classList.contains('show'), null, { timeout: 45000 });
    assert.ok(await pg.evaluate(() => document.getElementById('opPrepModal').classList.contains('show')), '"+ Add templates" closed the op-note room');
    await pg.click('#templatesModal .tpl-close-row button');
    await pg.waitForTimeout(600);
    const roomBack = await pg.evaluate(() => ({ room: document.getElementById('opPrepModal').classList.contains('show'), settings: document.getElementById('settingsModal').classList.contains('show'),
      tplInRoom: document.getElementById('templatesModal').parentElement.id === 'oprPanelTpls', tplShown: document.getElementById('templatesModal').classList.contains('show'), intake: document.getElementById('templatesModal').classList.contains('tpl-intake') }));
    assert.deepStrictEqual(roomBack, { room: true, settings: true, tplInRoom: true, tplShown: true, intake: false }, 'closing "Add templates" did not return the doctor to the op-note room\'s Templates tab: ' + JSON.stringify(roomBack));
    await pg.evaluate(() => { try { closeSettings(); } catch (e) { document.getElementById('settingsModal').classList.remove('show'); } try { closeTemplates(); } catch (e) {} try { closeOpPrep(); } catch (e) {} });

    /* ===== J. an account switch empties everything staged ===== */
    await pg.evaluate(() => window.openTemplateIntake());
    await pg.waitForSelector('#tplIntakePaste', { state: 'visible', timeout: 45000 });
    await paste(pg, X.threeA + '\n\n' + X.threeB + '\n\n' + X.threeC);
    await pg.fill('#tplIntakePaste', 'HPI:\nACCOUNT A PRIVATE TEMPLATE');
    await pg.evaluate(() => window.__mlsResetSessionBoundary('someone-else@mlsscribe.test', { reason: 'account-change' }));
    const afterJ = await pg.evaluate(() => ({ rows: _tplPendingSplit.length, carry: _tplPendingCarry.length, kept: _tplSortKeptRows.length, groups: Object.keys(_tplSortGroups).length, box: document.getElementById('tplMultiResult').innerHTML, paste: document.getElementById('tplIntakePaste').value, status: document.getElementById('tplMultiStatus').textContent }));
    assert.deepStrictEqual(afterJ, { rows: 0, carry: 0, kept: 0, groups: 0, box: '', paste: '', status: '' }, 'an account switch left staged template text behind: ' + JSON.stringify(afterJ));

    /* ===== I. signed in to the cloud library ===== */
    server.cloud = true;
    const sp = await boot({ viewport: { width: 1400, height: 900 } });
    server.device = await sp.evaluate(() => getTemplates());
    await signIn(sp);
    await intake(sp);
    calls = server.split.length;
    await paste(sp, X.lmn + '\n\n' + X.work);
    await paste(sp, X.caudal);
    assert.strictEqual(server.split.length, calls + 2, 'signed in, not one splitter call per paste');
    assert.deepStrictEqual((await rows(sp)).map(r => r.dest), ['letters', 'letters', 'op']);
    let release; const held = new Promise(r => { release = r; });
    server.hold = () => held;
    await sp.evaluate(() => { window.__toasts = []; });
    await sp.click('#tplSortSaveBtn');
    await sp.waitForFunction(() => /Adding templates/.test((document.getElementById('tplSortSaveBtn') || {}).textContent || ''), null, { timeout: 45000 });
    assert.ok(await sp.evaluate(() => document.getElementById('tplSortSaveBtn').disabled), 'the template library did not hold the Save button during the cloud save');
    server.hold = null; release();
    await sp.waitForFunction(() => /^Saved/.test(document.getElementById('tplMultiStatus').textContent), null, { timeout: 60000 });
    await sp.waitForTimeout(400);
    const saidI = await sp.textContent('#tplMultiStatus');
    assert.strictEqual(saidI, 'Saved 1 operative note template and 2 letters or other documents.', saidI);
    assert.deepStrictEqual(await sp.evaluate(() => window.__toasts.slice()), [saidI], 'the cloud save did not end in exactly one summary toast');
    const sent = server.preview[server.preview.length - 1].templates;
    assert.deepStrictEqual(sent.map(t => t.kind), ['letter', 'letter', 'op'], 'the cloud import did not carry the letter and op kinds: ' + JSON.stringify(sent.map(t => [t.name, t.kind])));
    server.park = true;
    FIX.push([P(longHpi.replace('Detail 1:', 'CLOUD LONG HPI:'), 'hpi', 'It is a long HPI.')]);
    await paste(sp, longHpi.replace('Detail 1:', 'CLOUD LONG HPI:'));
    await paste(sp, X.genicular);
    const saidI2 = await save(sp);
    assert.strictEqual(saidI2, 'Nothing was saved yet. 1 more is waiting for one more step below. 1 could not be saved - it is still here with the reason.', saidI2);
    await sp.waitForSelector('#tplMultiResult .tl-import-review', { state: 'visible', timeout: 45000 });
    await sp.click('#tplMultiResult [data-tl-import="cancel"]');
    await sp.waitForTimeout(300);
    assert.match(await sp.innerText('#tplSortKept'), /CLOUD LONG HPI|Not saved: 2,/, 'Cancel on the import card lost the refused row');
    server.park = false; server.cloud = false;

    /* ===== N. round 3's blocking repros, in real Chrome (tplsort-1.3.0) ===== */
    const np = await boot({ viewport: { width: 1400, height: 900 } });
    await signIn(np);
    await intake(np);
    const one = (goes, why) => () => ({ templates: [{ start: 1, goes, why }] });
    /* R3-0 (a): an Epic *** paste is ONE call with the whole text; no in-use section format becomes a bare heading */
    const beforeN = await state(np);
    server.model = one('visit', 'It is one visit note with Epic *** blanks.');
    calls = server.split.length;
    await paste(np, EPIC);
    assert.deepStrictEqual(server.split.slice(calls), [EPIC], 'the Epic paste was cut before the splitter saw it: ' + JSON.stringify(server.split.slice(calls)));
    list = await rows(np);
    assert.deepStrictEqual(list.map(r => r.dest), ['soap'], 'the Epic paste is not one whole visit note: ' + JSON.stringify(list));
    assert.ok(!/held \d+ templates/.test(await np.innerText('#tplMultiResult')), 'the Epic paste is said to hold several templates');
    assert.strictEqual(await save(np), 'Saved 1 to Whole visit note / SOAP.');
    const afterN = await state(np);
    for (const f of ['hpi', 'ros', 'exam', 'plan']) assert.deepStrictEqual(activeOf(afterN, f), activeOf(beforeN, f), 'the in-use ' + f + ' format changed: ' + JSON.stringify(activeOf(afterN, f)));
    const epicSaved = afterN.families.soap.profiles.filter(p => !beforeN.families.soap.profiles.some(o => o.id === p.id));
    assert.ok(epicSaved.length === 1 && (epicSaved[0].text.match(/\*\*\*/g) || []).length === 5, 'the Epic note was not saved whole with its five *** blanks: ' + JSON.stringify(epicSaved));
    /* R3-0 (c): the bulk op-note import - three files, three calls, three whole op templates; mbb.txt keeps every *** */
    server.model = one('op', 'It is a procedure note.');
    const opsBeforeN = afterN.ops.map(o => o.id);
    calls = server.split.length;
    await np.setInputFiles('#tplMultiFileInput', ['caudal.txt', 'genicular.txt', 'mbb.txt'].map(F));
    await np.waitForFunction(() => document.querySelectorAll('#tplMultiResult .tpl-sort-row').length >= 3 && /Check where each one is going/.test(document.getElementById('tplMultiStatus').textContent), null, { timeout: 90000 });
    assert.deepStrictEqual(server.split.slice(calls), [CAUDAL_SHORT, GENIC_SHORT, MBB], 'the op-note batch was not sent one whole file per call');
    assert.deepStrictEqual((await rows(np)).map(r => r.dest), ['op', 'op', 'op']);
    assert.strictEqual(await save(np), 'Saved 3 operative note templates.');
    const opsN = (await state(np)).ops.filter(o => !opsBeforeN.includes(o.id));
    assert.deepStrictEqual(opsN.map(o => [o.kind, o.text]).sort(), [['op', CAUDAL_SHORT], ['op', GENIC_SHORT], ['op', MBB]].sort(), 'the op-note batch was cut or lost a ***: ' + JSON.stringify(opsN.map(o => [o.name, o.kind, o.text.slice(0, 50)])));
    /* R3-1: a fill-in-the-blank form reads - uploaded as a .txt and pasted - and is added as a letter (kind letter) */
    server.model = one('letter', 'It is a work status form to fill in.');
    const libBeforeForm = (await state(np)).ops.map(o => o.id);
    await np.setInputFiles('#tplMultiFileInput', [F('work-status.txt')]);
    await np.waitForFunction(() => document.querySelectorAll('#tplMultiResult .tpl-sort-row').length >= 1 && /Check where each one is going/.test(document.getElementById('tplMultiStatus').textContent), null, { timeout: 90000 });
    await paste(np, WORK_FORM.replace('WORK STATUS REPORT', 'WORK STATUS REPORT - PASTED'));
    list = await rows(np);
    assert.deepStrictEqual(list.map(r => [r.dest, /couldn/.test(r.name)]), [['letters', false], ['letters', false]], 'a fill-in-the-blank form was refused: ' + JSON.stringify(list));
    assert.ok(!/could not extract|couldn’t be read|couldn't be read/.test(await np.textContent('#tplMultiStatus') + await np.innerText('#tplMultiResult')), 'a form is told it could not be read');
    assert.strictEqual(await save(np), 'Saved 2 letters or other documents.');
    const formsN = (await state(np)).ops.filter(o => !libBeforeForm.includes(o.id));
    assert.deepStrictEqual(formsN.map(o => o.kind), ['letter', 'letter'], 'the forms are not kind letter: ' + JSON.stringify(formsN.map(o => [o.name, o.kind])));
    assert.ok(formsN.every(o => /Physician signature: _{10,}/.test(o.text)), 'a form lost its signature line');
    server.model = null;
    /* R3-10: the EMR panel's AI sort never stages a patient note as a template */
    const emr = await np.evaluate(async () => {
      try { if (typeof closeTemplates === 'function') closeTemplates(); } catch (e) {}
      _tplDiscardSplit();
      const nb = document.getElementById('noteBox'); if (nb) { nb.value = 'HPI: knee pain for two weeks.\nPLAN: ice and rest.'; }
      const b = document.getElementById('emrBtn'); if (!b) return { btn: false };
      b.click();
      await new Promise(r => setTimeout(r, 300));
      const ai = document.getElementById('emrAi'); if (!ai) return { btn: true, panel: false };
      ai.click();
      await new Promise(r => setTimeout(r, 800));
      const why = document.getElementById('emrAiWhy');
      const out = { btn: true, panel: true, staged: _tplPendingSplit.length, why: why && why.style.display !== 'none' ? why.innerText : '' };
      const host = document.getElementById('emrPanel'); if (host) host.remove();
      return out;
    });
    const splitsAfterEmr = server.split.length;
    assert.ok(emr.btn && emr.panel, 'the EMR sections panel could not be opened: ' + JSON.stringify(emr));
    assert.strictEqual(emr.staged, 0, 'the EMR panel staged a patient note as a template');
    assert.match(emr.why, /AI sort is not available for a patient note\./, 'the AI sort button does not say why: ' + JSON.stringify(emr));
    assert.strictEqual(server.split.length, splitsAfterEmr, 'the patient note was sent to the template splitter');

    /* ===== M. phone: it fits, and the footer never covers a "Goes to" select ===== */
    const ph = await boot({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await signIn(ph);
    await ph.evaluate(() => openVisitNoteTemplates());
    await ph.waitForSelector('#mlsVnTplIntake', { state: 'visible', timeout: 45000 });
    await ph.tap('#mlsVnTplIntake');
    await ph.waitForSelector('#tplIntakePaste', { state: 'visible', timeout: 45000 });
    assert.strictEqual(await ph.evaluate(() => document.querySelector('#templatesModal h3').innerText.trim()), '📥 Add templates');
    for (const t of [X.soap, X.caudal, X.examImpression, X.plain, X.rosShort, [X.threeA, X.threeB, X.threeC].join('\n\n')]) await paste(ph, t);
    /* R3-6: a one-template paste with a cover page - its lines go back at the top, with the choices to leave them out or make them a template */
    server.model = (d) => ({ templates: [{ start: SPLIT.startsOf(d, [{ first: 'NEW PATIENT - LOW BACK' }])[0], goes: 'visit', why: 'It is a new patient visit.', name: 'New patient - low back' }] });
    await paste(ph, COVERED);
    server.model = null;
    const coverRow = (await rows(ph)).slice(-1)[0];
    assert.ok(coverRow.dest === 'soap' && /The first 2 lines read as a cover page; they are kept at the top of this template\./.test(coverRow.cover) && /Leave them out/.test(coverRow.cover) && /Add them as a template/.test(coverRow.cover), 'the cover row is not offered its choices: ' + JSON.stringify(coverRow));
    assert.strictEqual((await pending(ph)).slice(-1)[0].text, COVERED, 'the one-template paste lost its cover lines');
    await ph.tap('#tplMultiResult .tpl-sort-row[data-tpl-row="2"] .tpl-sort-full summary');
    const fit = await ph.evaluate(() => {
      const vw = document.documentElement.clientWidth, over = [];
      document.querySelectorAll('#tplIntakeCard, #tplIntakeCard textarea, #tplMultiResult .tpl-sort-row, #tplMultiResult select, #tplMultiResult .tpl-sort-text, #tplMultiResult .tpl-sort-use, #tplSortSaveBtn').forEach(el => {
        const r = el.getBoundingClientRect(); if (r.width && (r.left < -1 || r.right > vw + 1)) over.push((el.id || el.className) + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
      });
      const sideways = [];
      for (let el = document.getElementById('tplIntakeCard'); el && el !== document.body; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && !['hidden', 'visible'].includes(getComputedStyle(el).overflowX)) sideways.push(el.id || el.className);
      const sel = document.getElementById('tplSortDest_0').getBoundingClientRect();
      return { vw, over, sideways, page: document.documentElement.scrollWidth <= vw + 1, selectW: Math.round(sel.width), textShown: !!document.querySelector('#tplMultiResult .tpl-sort-row[data-tpl-row="2"] .tpl-sort-text').offsetHeight };
    });
    assert.deepStrictEqual(fit.over, [], 'on a phone the one place does not fit the screen: ' + JSON.stringify(fit));
    assert.deepStrictEqual(fit.sideways, [], 'on a phone the panel scrolls sideways: ' + JSON.stringify(fit));
    assert.ok(fit.page && fit.selectW >= 150 && fit.textShown, 'on a phone a control is too small, the page scrolls sideways or the full text does not open: ' + JSON.stringify(fit));
    /* scroll the panel from top to bottom: at no position does the footer lie over a select */
    const covered = await ph.evaluate(async () => {
      const scroller = (function () { for (let el = document.getElementById('tplMultiResult'); el; el = el.parentElement) { const cs = getComputedStyle(el); if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) return el; } return document.scrollingElement; })();
      const foot = document.querySelector('#tplMultiResult > .tpl-split-actions');
      const hits = [];
      for (let y = 0; y <= scroller.scrollHeight; y += 60) {
        scroller.scrollTop = y; await new Promise(r => requestAnimationFrame(() => r()));
        const fr = foot.getBoundingClientRect();
        document.querySelectorAll('#tplMultiResult select').forEach(s => { const r = s.getBoundingClientRect(); if (r.bottom > fr.top + 1 && r.top < fr.bottom - 1 && r.right > fr.left && r.left < fr.right) hits.push(s.id + '@' + y); });
      }
      return { hits, position: getComputedStyle(foot).position };
    });
    assert.deepStrictEqual(covered.hits, [], 'on a phone the Save/Discard footer covers a "Goes to" select: ' + JSON.stringify(covered));
    await ph.locator('#tplMultiResult .tpl-sort-row[data-tpl-row="2"] .tpl-sort-use').scrollIntoViewIfNeeded();
    await ph.tap('#tplMultiResult .tpl-sort-row[data-tpl-row="2"] .tpl-sort-use');
    await ph.selectOption('#tplSortDest_3', 'plan');
    await ph.locator('#tplSortSaveBtn').scrollIntoViewIfNeeded();
    await ph.tap('#tplSortSaveBtn');
    await ph.waitForFunction(() => /^Saved/.test(document.getElementById('tplMultiStatus').textContent), null, { timeout: 60000 });
    assert.strictEqual(await ph.textContent('#tplMultiStatus'), 'Saved 2 to Whole visit note / SOAP, 1 to HPI, 1 to ROS, 2 to Exam, 2 to Plan and 1 operative note template.');
    const afterPh = await state(ph);
    assert.ok(/Please keep this for later/.test(activeOf(afterPh, 'plan').text || '') || afterPh.families.plan.profiles.some(p => /Please keep this for later/.test(p.text)), 'on a phone, the row the doctor placed in Plan was not saved there');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS template intake sorts everything (real Chrome, desktop and phone): Settings\' "+ Add templates" opens the one place; every file and every paste goes to the splitter ONCE and each row is placed exactly as it answered, with its reason - ' +
      'a double-spaced paste and a .docx of three visits keep each template\'s own last line, two letters in one file are two rows, an op report keeps its post-operative instructions, the op note that mentions prior authorization is kind op, ' +
      'every letter kind letter (never the drafting kind insurance); an unsure row asks with a one-tap best guess and Save refuses until every row has a place; a doctor\'s pending "+ Add" is not taken over and Cancel still restores the prior format; ' +
      'unsaved typing in a row editor is kept and the doctor is told where the import went; one-section templates and every Split part leave their own heading off (never a required heading); ' +
      'a 5xx or a 429 keeps each paste whole, says why once and "Try sorting again" sorts them; an answer that rewrote the text is kept whole and said truly once; signed out nothing is sent, cut or placed; ' +
      '"+ Add templates" from the op-note room returns to the room; limits and the cloud library keep refused rows in sight; an account switch empties everything; and on a phone it fits and the footer never covers a select. ' +
      'Round 3\'s blockers: an Epic *** paste is one whole call and no in-use section becomes a bare heading; a batch of op notes with *** blanks is three whole op templates; a fill-in-the-blank form reads, uploaded or pasted, and is added as kind letter; a one-template file keeps its cover lines at the top with the choices to change it; the EMR panel never stages a patient note');
  } finally { await b.close(); srv.close(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
});
