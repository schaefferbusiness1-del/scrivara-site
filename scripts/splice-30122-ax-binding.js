'use strict';
// Mechanical byte-preserving correction of the AX read binding and date proof.
const assert = require('assert'), fs = require('fs'), path = require('path');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let after = before;
const edits = [];
function replace(oldText, newText) {
  assert(after.includes(oldText) && after.indexOf(oldText) === after.lastIndexOf(oldText), 'unique source seam: '+oldText.slice(0,100));
  after = after.replace(oldText,newText); edits.push([oldText,newText]);
}
const at=before.indexOf("    if (op === 'axRead') {");
const eol=before.slice(at).split('\n')[0].endsWith('\r')?'\r\n':'\n';
replace("    if (op === 'axRead') {", [
 "    if (op === 'axRead') {",
 '      /* axbind-30122: navigation acceptance is not a landed encounter.',
 '         Bind this synchronous capture to the exact requested route twice. */',
 "      var axExpectedPath = String(idx || '');",
 "      if (!/^\\/\\d+\\/\\d+\\/ax\\/encounter\\/\\d+\\/\\w+$/.test(axExpectedPath)) return {ok:false,reason:'ax-read-unbound'};",
 "      if (String(location.pathname || '') !== axExpectedPath) return {ok:false,reason:'ax-encounter-not-settled'};"
].join(eol));
replace("      var axDm = axRaw.match(/\\b(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4})\\b/);"+eol+
 "      return { ok: axRaw.length > 0, raw: axRaw, headerDate: axDm ? axDm[1] : '', len: axRaw.length };",[
 '      /* A first page date may be DOB. Only a labeled encounter date can',
 '         prove a scoped-day inclusion/exclusion; conflicting dates stay unknown. */',
 "      var axDateRe = /\\b(?:encounter date|date of (?:service|visit|encounter)|visit date|service date|DOS)\\s*[:#-]?\\s*(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4})\\b/gi;",
 "      var axDates = [], axDm; while ((axDm = axDateRe.exec(axRaw))) { if (axDates.indexOf(axDm[1]) < 0) axDates.push(axDm[1]); }",
 "      if (String(location.pathname || '') !== axExpectedPath) return {ok:false,reason:'ax-encounter-changed'};",
 "      return { ok: axRaw.length > 0, raw: axRaw, headerDate: axDates.length === 1 ? axDates[0] : '', len: axRaw.length, encounterPath: axExpectedPath };"
].join(eol));
const start=after.indexOf('            var axBody = null;');
const end=after.indexOf('            /* scoped-census-30121:',start);
assert(start>0&&end>start);
const routeEol=after.slice(start).split('\n')[0].endsWith('\r')?'\r\n':'\n';
replace(after.slice(start,end),[
 '            var axBody = null;',
 '            var axBodyDeadline = Math.min(readDeadline - 500, Date.now() + 5200);',
 '            do {',
 "              var axRd = await exec(emrId, [axBestFrame], ['axRead', cfg, axE.hrefPath]);",
 '              axBody = bestResult(axRd, function (r) { return (r && r.ok && r.raw) ? r.raw.length : 0; }).result;',
 '              if (axBody && axBody.ok) break;',
 "              if (axBody && axBody.reason && axBody.reason !== 'ax-encounter-not-settled') break;",
 '              if (Date.now() + 700 >= axBodyDeadline) break;',
 '              await sleep(700); touchVisitLease();',
 '            } while (Date.now() < axBodyDeadline);',
 "            if (!axBody || !axBody.ok || axBody.encounterPath !== axE.hrefPath) { axRefused++; continue; }",
 '            /* Recheck the patient after capture, before any keep/date decision. */',
 "            var axAfterIds = await exec(emrId, [axBestFrame], ['identity', cfg]);",
 '            var axAfterIdent = bestResult(axAfterIds, function (r) { return (r && r.name ? 20 : 0) + (r && r.dob ? 15 : 0) + (r && r.mrn ? 10 : 0) + ((r && r.score) || 0); }).result || null;',
 '            if (!axAfterIdent || !visitIdentityGate(frozenHint, axAfterIdent).ok) { axRefused++; continue; }',
 '            axIdent = axAfterIdent;',
 ''
].join(routeEol));
let restored=after;
for(const [oldText,newText] of edits.slice().reverse()) {assert(restored.indexOf(newText)===restored.lastIndexOf(newText));restored=restored.replace(newText,oldText);}
assert.strictEqual(restored,before,'inverse source-byte preservation');
fs.writeFileSync(target,Buffer.from(after,'latin1'));
console.log('Applied AX exact encounter binding and date evidence; inverse byte preservation passed.');
