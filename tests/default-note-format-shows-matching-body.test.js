/* default-note-format-shows-matching-body
 *
 * b785 added a "Default note format" setting and set currentFormat from it at
 * both generation sites - but kept showNote(currentSoap) hardcoded. With the
 * default set to Insurance-Ready, the toggle claimed insurance while the
 * editor held the SOAP text; every capture path that trusts currentFormat then
 * corrupted state (setFormat('soap') wrote the SOAP text over the AI insurance
 * note; print + note records saved SOAP text labeled insurance). Harness-proven
 * by the 2026-07-29 QA fleet.
 *
 * The fix: each generation site demotes currentFormat to 'soap' when no
 * insurance body exists, and shows the body that MATCHES currentFormat.
 * This contract pins both halves at both sites, and pins setFormat's
 * capture-before-swap so the toggle's save-back semantics stay coherent.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');

function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

const shows = count(html, "showNote(currentFormat==='insurance'?currentInsurance:currentSoap);");
if (shows !== 2) {
  console.error('FAIL: expected exactly 2 format-matched showNote calls (offline example + real generation), found ' + shows);
  process.exit(1);
}

const demotes = count(html, "if(currentFormat==='insurance'&&!(currentInsurance&&currentInsurance.trim()))currentFormat='soap';");
if (demotes !== 2) {
  console.error('FAIL: expected exactly 2 no-body demotion guards before the format-matched showNote calls, found ' + demotes);
  process.exit(1);
}

/* Exactly ONE hardcoded showNote(currentSoap) may remain: the history-restore
 * path, which is honest because it first forces currentFormat='soap'
 * (restored notes always reopen in standard SOAP). Anything beyond that one,
 * or the restore path losing its format reset, reopens the lie. */
if (count(html, 'showNote(currentSoap);') !== 1) {
  console.error('FAIL: expected exactly 1 hardcoded showNote(currentSoap) (the history-restore path, which forces soap first), found ' + count(html, 'showNote(currentSoap);'));
  process.exit(1);
}
if (!html.includes("currentOpt=n.opt||null; currentFormat='soap'; lastEMR=n.emr||null;")) {
  console.error('FAIL: the history-restore path no longer forces currentFormat=soap before its hardcoded SOAP showNote');
  process.exit(1);
}

// setFormat must keep capturing the OUTGOING format's body before swapping,
// so a format-matched editor never overwrites the other body with wrong text.
if (!html.includes("if(currentFormat==='soap') currentSoap=nb.value; else currentInsurance=nb.value;")) {
  console.error('FAIL: setFormat no longer captures the outgoing body before the swap');
  process.exit(1);
}

console.log('PASS default note format: generation shows the body that matches currentFormat, demotes honestly when no insurance body exists, and setFormat swap semantics are intact');
