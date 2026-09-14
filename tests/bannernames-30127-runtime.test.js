'use strict';
/* MLS Assist 3.0.127 — bannernames-1.0.0: a chart banner that prints a used name AND a
 * "Legal: ..." name identifies the patient by either name athena prints; the exact
 * first+last+DOB rule is otherwise unchanged (no nickname table, DOB exact). Executes the
 * real light-DOM banner reader and the real handler matcher on synthetic banners. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const helpers = require(path.join(root, 'scripts', 'exact-identity-30123.js'));
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
function lift(name) {
  const s = bg.indexOf('function ' + name + '() {');
  ok(s > 0, name + ' present');
  let d = 0, e = s; for (; e < bg.length; e++) { if (bg[e] === '{') d++; else if (bg[e] === '}') { d--; if (d === 0) { e++; break; } } }
  return bg.slice(s, e);
}
const reader = new Function('document', 'location', lift('mlsReadChartIdentity') + '\nreturn mlsReadChartIdentity();');
function run(text) {
  return reader({ body: { innerText: text, getBoundingClientRect: () => ({ width: 900, height: 700 }) } }, { href: 'https://athenanet.athenahealth.com/1/1/ax/chart/1' });
}

/* 1. collapsed strip: used name, then "Legal:" then the legal name on the next line */
{
  const r = run('Apps\nCathy EXAMPLE\nLegal:\nCatherine A EXAMPLE\n70yo F | 01-02-1956 | #123456\nProblems\nMedications');
  eq(r.via, 'banner', 'banner pass');
  const printed = [r.name].concat(r.altNames).sort();
  assert.deepStrictEqual(printed, ['Catherine A EXAMPLE', 'Cathy EXAMPLE'], 'both printed names are available (primary + alternative)'); checks++;
  eq(r.dob, '01/02/1956', 'dob');
  eq(r.mrn, '123456', 'mrn');
}
/* 2. expanded drawer: "Used Legal: Legal" on one line */
{
  const r = run('Bob EXAMPLE Legal: Robert EXAMPLE\n61yo M | 03-04-1965 | #7777777\nProblems');
  eq(r.name, 'Bob EXAMPLE', 'the used name before the colon is the primary name');
  assert.deepStrictEqual(r.altNames, ['Robert EXAMPLE']); checks++;
}
/* 3. a banner without a legal name collects nothing */
{
  const r = run('Jane SAMPLE\n40yo F | 05-06-1986 | #24680\nProblems');
  eq(r.name, 'Jane SAMPLE', 'plain banner');
  assert.deepStrictEqual(r.altNames, []); checks++;
}
/* 4. the handler's matcher accepts either printed name and nothing else */
{
  const s = bg.indexOf('/* bannernames-1.0.0 START */'), e = bg.indexOf('/* bannernames-1.0.0 END */');
  ok(s > 0 && e > s, 'matcher markers present');
  const any = new Function('mlsExactIdentityPair', bg.slice(s, e) + '\nreturn exactPairAny;')(helpers.mlsExactIdentityPair);
  const who = { name: 'Cathy EXAMPLE', dob: '01/02/1956', mrn: '123456', altNames: ['Catherine A EXAMPLE'] };
  eq(any({ name: 'Catherine A Example', dob: '1956-01-02' }, who).ok, true, 'legal name on the row matches the banner alt name');
  eq(any({ name: 'Catherine A Example', dob: '1956-01-02' }, who).viaAltName, true, 'the match is marked as via the alternative name');
  eq(any({ name: 'Cathy Example', dob: '1956-01-02' }, who).ok, true, 'used name still matches directly');
  eq(any({ name: 'Cath Example', dob: '1956-01-02' }, who).ok, false, 'a nickname that athena did not print never matches');
  eq(any({ name: 'Catherine A Example', dob: '1956-01-03' }, who).ok, false, 'DOB stays exact');
  eq(any({ name: 'Catherine A Example', dob: '' }, who).reason, 'identity-hint-incomplete', 'no DOB still refuses');
  eq(any({ name: 'Catherine A Example', dob: '1956-01-02' }, { name: 'Cathy EXAMPLE', dob: '01/02/1956' }).ok, false, 'no alt names -> ordinary refusal');
}
/* 5. the gate uses the matcher; the shadow reader collects the legal first name */
ok(bg.includes("const exactGlobalPair = want ? exactPairAny({name:want,dob:wantDob,mrn:wantMrn}, ident || {}) : { ok: false, reason: 'no-target' };"), 'chart gate uses exactPairAny');
ok(bg.includes("return exactPairAny({name:want,dob:wantDob,mrn:wantMrn},who).ok;"), 'frame binding uses exactPairAny');
ok(bg.includes("var legalFirstS = labelVal(lines, /^legal first name$/i), altNamesS = [];"), 'shadow reader collects the legal first name');
ok(bg.includes("var r = { name: name, dob: dob, mrn: mrn, altNames: altNamesS,"), 'shadow reader returns altNames');
/* 6. bannernames-1.1.0 (3.0.128): the shadow reader's strategy B splits "Used Legal: Legal" into both printed names */
{
  const s = bg.indexOf("            var joinedB = lines.slice(i3 - kk, i3)");
  const eMark = "else if (candB !== nameB && altNamesS.indexOf(candB) < 0) altNamesS.push(candB); }";
  const e = bg.indexOf(eMark, s);
  ok(s > 0 && e > s, 'strategy B split present');
  const body = bg.slice(s, e + eMark.length);
  const fn = new Function('lines', 'i3', 'kk', 'okName', 'altNamesS', 'var nameB = "";' + body + '\nreturn nameB;');
  const okName = (c) => /^[A-Z][A-Za-z'\-\.]*(?:\s+[A-Z][A-Za-z'\-\.]*){1,3}$/.test(c) ? c : '';
  const alts = [];
  eq(fn(['Bob EXAMPLE Legal: Robert EXAMPLE', '61yo M | 03-04-1965 | #7777777'], 1, 1, okName, alts), 'Bob EXAMPLE', 'used name is the primary');
  assert.deepStrictEqual(alts, ['Robert EXAMPLE'], 'legal name rides as the alternative'); checks++;
  const alts2 = [];
  eq(fn(['Legal: Robert EXAMPLE', '61yo M | 03-04-1965 | #7777777'], 1, 1, okName, alts2), 'Robert EXAMPLE', 'a legal-only line still names the patient');
  eq(alts2.length, 0, 'no duplicate alternative');
  ok(!bg.includes("            nameB = okName(lines.slice(i3 - kk, i3).join(' ').replace(/\\s+/g, ' ').trim());"), 'the colon-blind join is gone');
}
/* 7. the wrong-chart refusal carries PHI-free reader evidence */
ok(bg.includes("bannerNamesPrinted: 1 + ((ident && Array.isArray(ident.altNames)) ? ident.altNames.length : 0), identVia: (ident && ident.via) || '', pairReason: exactGlobalPair.reason || '',"), 'wrong-chart refusal reports printed-name count, reader and pair reason');
console.log('PASS bannernames-30127-runtime: ' + checks + ' checks');
