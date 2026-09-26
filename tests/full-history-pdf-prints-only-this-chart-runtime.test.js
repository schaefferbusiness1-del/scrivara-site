'use strict';

/* h10-1.0.0 (2026-09-25): "Export full history (PDF)" prints only the open
 * chart's own visits, keeps each procedure note's own clinician, and never
 * drops a character silently.
 *
 *   JOBS-1  The PDF compiled EVERY row in p.visits: a row the visit model binds
 *           to another chart printed under this patient's name (its procedure
 *           note relabelled with this patient's name, DOB and MRN), and an
 *           index-only shell printed as "No documented content". Only the rows
 *           __mlsVisitModel.usableVisits(p) returns may print; the cover counts
 *           the rest as not included.
 *   JOBS-2  Every past procedure note was headed "Provider: <current user>";
 *           the note's own "Surgeon:" line was consumed and gone.
 *   JOBS-7  Everything outside Latin-1 was deleted: "Nguyen Thi Huong" printed
 *           as "Nguyn Th Hng", and arrows / <= / >= vanished from the plan.
 *
 * Real Chrome, the real feat_visits.js, mls-opnote-pro.js, the vendored jsPDF
 * and both the /1p source and its derived production copy. The saved PDF is
 * parsed; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['1p-feat_fullhistory_pdf.js', 'feat_fullhistory_pdf.js'];

const OWN_OP = ['PROCEDURE NOTE', 'Patient: Synthetic Alpha', 'DOB: 01/01/1970', 'Surgeon: Robert Jones, MD', 'Date of Procedure: 04/01/2026',
  'PREOPERATIVE DIAGNOSIS: Lumbar radiculopathy M54.16',
  'PROCEDURE(S) PERFORMED: Right L4-5 transforaminal epidural steroid injection, CPT 64483',
  'DESCRIPTION OF PROCEDURE: After informed consent the patient was placed prone. Performed by Dr. Jones under fluoroscopy.'].join('\n');
const GAMMA_OP = ['PROCEDURE NOTE', 'Patient: Synthetic Gamma', 'DOB: 05/05/1955', 'Surgeon: Robert Jones, MD', 'Date of Procedure: 03/01/2026',
  'PROCEDURE(S) PERFORMED: Left knee genicular nerve block, CPT 64454', 'DESCRIPTION OF PROCEDURE: Gamma consented; left knee prepped.'].join('\n');

const ALPHA = { id: 'pt-A', name: 'Synthetic Alpha', dob: '1970-01-01', mrn: 'MRN-A', visits: [
  { id: 'v1', date: '2026-05-01', type: 'Office visit', raw: 'ALPHA OWN NOTE: low back pain follow-up, pain 3/10.', source: 'mls' },
  { id: 'v2', date: '2026-04-01', type: 'Procedure', raw: OWN_OP, source: 'athena-history', identityVerified: true, identityBinding: 'pt-A', fullDetail: true },
  { id: 'v3', date: '2026-03-01', type: 'Procedure', raw: GAMMA_OP, source: 'athena-history', identityVerified: true, identityBinding: 'pt-G' },
  { id: 'v4', date: '2026-02-15', type: 'Office visit', raw: 'Patient: Synthetic Gamma. GAMMA NOTE: start warfarin 5 mg daily.', source: 'athena-history', identityVerified: true, identityBinding: 'pt-G' },
  { id: 'v5', date: '2026-02-01', type: 'Office visit', source: 'athena-history', indexOnly: true, textHead: 'Office visit - index only, body not pulled', identityVerified: true, identityBinding: 'pt-A' },
  { id: 'v6', date: '2026-01-10', type: 'Office visit', raw: 'LEGACY UNVERIFIED ATHENA ROW: identity never checked.', source: 'athena-visits' }
] };
const NGUYEN = { id: 'pt-N', name: 'Nguy\u1ec5n Th\u1ecb H\u01b0\u01a1ng', dob: '1970-01-01', mrn: 'MRN-N', visits: [
  { id: 'n1', date: '2026-06-01', type: 'Office visit', source: 'mls',
    raw: 'Plan: \u2191 gabapentin 300 \u2192 600 mg TID; \u2193 oxycodone; goal pain \u2264 3/10; \u2265 50% relief after injection. Interpreter: \u674e. Assessment: L4\u2011L5 lumbar\u200Bradiculopathy; MRI\u2060shows T2\u2010weighted change.' },
  { id: 'n2', date: '2026-02-01', type: 'Office visit', raw: 'Initial consult, 10 \u03bcg dose noted.', source: 'mls' }
] };

const HOST = (mod) => '<!doctype html><meta charset=utf-8><body><div id="mlsVisitHistory"><div class="mlsvh-head">Visit history</div></div>' +
  '<script>window.__pt=null;window.getPatients=function(){return window.__pt?[window.__pt]:[];};' +
  'window.activePatient=function(){return window.__pt;};window.getActivePtId=function(){return window.__pt&&window.__pt.id;};' +
  "window.clinicalProviderName=function(){return 'Current User, MD';};</script>" +
  '<script src="/vendor/jspdf.umd-4.2.1.min.js"></script><script src="/mls-opnote-pro.js"></script>' +
  '<script src="/feat_visits.js"></script><script src="/' + mod + '"></script></body>';

/* jsPDF writes uncompressed content streams: every drawn string is a "(...) Tj". */
function pdfStrings(file) {
  const pdf = fs.readFileSync(file, 'latin1');
  return [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1'));
}
function byPage(strings) {
  const pages = { cover: [] }; let cur = 'cover';
  for (const s of strings) { const m = s.match(/^VISIT (\d+) OF/); if (m) cur = 'visit' + m[1]; (pages[cur] = pages[cur] || []).push(s); }
  return pages;
}

const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  const host = p.match(/^\/__host\/(.+)$/);
  if (host) { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(HOST(host[1])); }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': path.extname(f) === '.js' ? 'application/javascript' : 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fhpdf-'));
  let checks = 0;
  const ok = (v, m) => { assert.ok(v, m); checks++; };
  const eq = (a, e, m) => { assert.strictEqual(a, e, m); checks++; };
  try {
    for (const mod of MODULES) {
      const ctx = await browser.newContext({ acceptDownloads: true });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message)));
      await page.goto('http://127.0.0.1:' + srv.address().port + '/__host/' + mod, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__mlsFullHistoryPdf && window.__mlsVisitModel && window.__mlsOpNotePro);
      const exportFor = async (patient, label, useButton) => {
        await page.evaluate((pt) => { window.__pt = pt; }, patient);
        if (useButton) await page.waitForSelector('[data-mls-fhpdf]');
        const [dl] = await Promise.all([page.waitForEvent('download'),
          useButton ? page.click('[data-mls-fhpdf]') : page.evaluate(() => window.__mlsFullHistoryPdf.build(window.__pt))]);
        const file = path.join(tmp, mod + '-' + label + '.pdf');
        await dl.saveAs(file);
        return { name: dl.suggestedFilename(), strings: pdfStrings(file) };
      };

      /* ---- JOBS-1: only this chart's own rows, never relabelled ---- */
      const alpha = await exportFor(ALPHA, 'alpha', true);
      const usable = await page.evaluate(() => window.__mlsVisitModel.usableVisits(window.__pt).map((v) => v.id).sort());
      eq(usable.join(','), 'v1,v2', mod + ': fixture drifted - the visit model no longer gates these rows');
      const all = alpha.strings.join('\n');
      ok(!/GAMMA|Gamma|warfarin|genicular|64454/.test(all), mod + ': a visit bound to another chart printed in this patient\'s PDF');
      ok(!/LEGACY UNVERIFIED/.test(all), mod + ': an unverified athena row printed as this patient\'s visit');
      ok(!/No documented content recorded/.test(all), mod + ': an index-only shell printed as an empty visit');
      ok(/ALPHA OWN NOTE/.test(all), mod + ': the chart\'s own MLS visit was not printed');
      ok(/Right L4-5 transforaminal/.test(all), mod + ': the chart\'s own verified procedure note was not printed');
      ok(alpha.strings.includes('Visits in this document: 2'), mod + ': the cover does not count the printed visits');
      ok(alpha.strings.some((s) => /^Not included: 4 visit records not verified as this patient's own/.test(s)),
        mod + ': the cover does not say how many records were left out');
      ok(alpha.strings.some((s) => /^VISIT 2 OF 2/.test(s)) && !alpha.strings.some((s) => /^VISIT \d+ OF [3-9]/.test(s)),
        mod + ': the PDF has visit pages for rows that are not this chart\'s own');

      /* ---- JOBS-2: the note's own clinician is kept ---- */
      const pages = byPage(alpha.strings);
      const opPage = Object.keys(pages).find((k) => k !== 'cover' && pages[k].some((s) => /Right L4-5/.test(s)));
      ok(opPage, mod + ': the procedure note page was not found');
      ok(pages[opPage].includes('Provider: Robert Jones, MD'), mod + ': the procedure note lost the clinician who performed it: ' +
        JSON.stringify(pages[opPage].filter((s) => /^Provider:/.test(s))));
      ok(!Object.keys(pages).some((k) => k !== 'cover' && pages[k].some((s) => /Current User/.test(s))),
        mod + ': a past visit page names the user compiling the PDF as its provider');
      ok(pages.cover.some((s) => /^Provider: Current User, MD/.test(s)), mod + ': the compiler left the cover letterhead');
      ok(pages[opPage].includes('Patient: Synthetic Alpha'), mod + ': the chart\'s own procedure note lost its patient line');

      /* ---- JOBS-7: nothing dropped silently ---- */
      const ng = await exportFor(NGUYEN, 'nguyen', false);
      const ngAll = ng.strings.join('\n');
      ok(ng.strings.includes('Patient: Nguyen Thi Huong'), mod + ': the patient name lost letters: ' + JSON.stringify(ng.strings.filter((s) => /^Patient:/.test(s))));
      ok(/^VisitHistory_Nguyen_Thi_Huong_\d{8}\.pdf$/.test(ng.name), mod + ': the file name lost letters: ' + ng.name);
      ok(/increase gabapentin 300 -> 600 mg TID; decrease oxycodone; goal pain <= 3\/10; >= 50% relief/.test(ngAll),
        mod + ': the plan lost the direction of a change or an inequality: ' + JSON.stringify(ng.strings.filter((s) => /gabapentin/.test(s))));
      ok(/Interpreter: \[\?\]\./.test(ngAll), mod + ': a character the font cannot print vanished instead of showing [?]');
      /* h10-1.0.1: invisible characters print as nothing and Unicode hyphens as '-', never as [?] */
      ok(/L4-L5 lumbarradiculopathy; MRIshows T2-weighted change\./.test(ngAll), mod + ': a hyphen or an invisible character was not printed as its plain form: ' + JSON.stringify(ng.strings.filter((s) => /L4/.test(s))));
      ok(/10 \xb5g dose/.test(ngAll), mod + ': a Greek mu was not kept as the micro sign');
      ok(ng.strings.some((s) => /^Date range: Feb 1, 2026 +-> +Jun 1, 2026$/.test(s)), mod + ': the cover date range lost its arrow');
      const notes = ng.strings.filter((s) => /^This PDF font prints Latin-1 text only: /.test(s));
      ok(notes.length >= 3 && notes.every((s) => s === notes[0]), mod + ': not every page says the font changed characters');
      ok(/\d+ accents removed from letters/.test(notes[0]) && /1 character shown as \[\?\]/.test(notes[0]), mod + ': the font notice is wrong: ' + notes[0]);
      ok(!alpha.strings.some((s) => /^This PDF font prints/.test(s)), mod + ': a Latin-1-only PDF carries a font notice');

      eq(errors.length, 0, mod + ': page errors: ' + errors.join(' | '));
      await ctx.close();
    }
    console.log('PASS full-history PDF prints only this chart\'s own visits, keeps each procedure note\'s clinician, and says what the font changed (' + checks + ' checks)');
  } catch (e) {
    console.error(e && e.stack || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
