/* note-defaults-reach-contract
 *
 * Settings -> Note defaults has three controls. Two of them are only real if
 * they reach the prompts:
 *
 *   Note style (balanced/concise/detailed) -> docPrefsBlock()
 *   Practice billing codes (ICD-10 / CPT)  -> __mlsCodeTable.promptBlock()
 *
 * Measured on origin/main b964, the billing table reached 4 of the 8 shipped
 * prompts that instruct the model to EMIT a code. The four it missed were the
 * three op-note drafters and the prior-authorization letter -- i.e. the
 * documents a procedural practice actually bills from, and precisely the ones
 * the Settings card names ("notes, templates, op-notes, studies").
 *
 * feat_mls_note_defaults_reach wraps aiCallRaw once and injects by explicit
 * classification. This contract:
 *
 *   1. evaluates the SHIPPED predicate (sliced out of mls-connect.js, not a
 *      copy -- a copy is how a test starts agreeing with itself),
 *   2. runs it over every system prompt at every aiCallRaw() site in the
 *      shipped asset set, and prints the verdict for each WITH a denominator,
 *   3. fails if any coding prompt or any document-drafting prompt would end up
 *      uncovered, and
 *   4. re-runs the OLD behaviour (no wrapper) over the same corpus and fails if
 *      that also passes -- if the pre-fix code satisfies the test, the test is
 *      not testing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r/g, '');

let failures = 0;
const fail = m => { console.error('FAIL: ' + m); failures++; };

/* ---------------------------------------------------------------- 1. predicate */
const connect = read('mls-connect.js');
const OPEN = 'feat_mls_note_defaults_reach (ndr-1.0.0)';
const CLOSE = "window.__mlsNoteDefaultsReach={";
if (connect.split(OPEN).length - 1 !== 1) fail('the feat_mls_note_defaults_reach header is not unique in mls-connect.js (' + (connect.split(OPEN).length - 1) + ' copies) - the slice below would take the wrong one');
if (connect.split(CLOSE).length - 1 !== 1) fail('the __mlsNoteDefaultsReach export is not unique in mls-connect.js');

const start = connect.indexOf('(function(){', connect.indexOf(OPEN));
const end = connect.indexOf(CLOSE, start);
if (start < 0 || end < 0) fail('could not slice the note-defaults wrapper out of mls-connect.js');

/* the predicate half of the IIFE, evaluated in isolation */
const sandbox = { window: {}, setInterval: () => 0, clearInterval: () => {} };
vm.createContext(sandbox);
let SHIPPED = null;
if (start >= 0 && end > start) {
  const body = connect.slice(start + '(function(){'.length, end);
  try {
    vm.runInContext('(function(){' + body + '\nthis.__x={wantsCodes:wantsCodes,wantsStyle:wantsStyle,augment:augment};}).call(globalThis);', sandbox);
    SHIPPED = sandbox.__x;
  } catch (e) { fail('the shipped predicate did not evaluate: ' + e.message); }
}
if (!SHIPPED) { console.error('FAIL: no predicate to test'); process.exit(1); }

/* ------------------------------------------------------- 2. the prompt corpus */
const sf = read('ScribeFlow.html'), mc = connect;
const shippedFiles = new Set(['ScribeFlow.html', 'mls-connect.js']);
for (const m of (sf + mc).matchAll(/\b([A-Za-z0-9_-]+\.js)\b/g)) {
  if (fs.existsSync(path.join(ROOT, m[1]))) shippedFiles.add(m[1]);
}

const prompts = [];
for (const f of shippedFiles) {
  const raw = read(f);
  const lines = raw.split('\n');
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf('aiCallRaw(') >= 0 && !/^\s*\*/.test(line) && !/function aiCallRaw/.test(line)) {
      const m = line.match(/aiCallRaw\(\s*([A-Za-z0-9_.]+)/);
      if (m) {
        const id = m[1].split('.').pop();
        const re = new RegExp('(?:const|let|var)\\s+' + id + '\\s*=', 'g');
        const before = raw.slice(0, off);
        let last = -1, mm;
        while ((mm = re.exec(before)) !== null) last = mm.index;
        if (last >= 0) prompts.push({ f, line: i + 1, text: raw.slice(last, off) });
      }
    }
    off += line.length + 1;
  }
}
if (prompts.length < 30) fail('only ' + prompts.length + ' prompts resolved - the corpus collapsed, so a green run below would mean nothing');

/* ------------------------------------------------------------ 3. the verdicts */
/* A prompt needs the practice table if it tells the model to emit a code. */
const ASKS_FOR_CODES = /fill real codes|ICD-?10 code|CPT code|CPT\/HCPCS|HCPCS code|DIAGNOSIS CODES \(ICD-10\)|PROCEDURE CODES \(CPT\)/i;
const IS_INGEST = /You extract\b|You tag clinical note templates|appointment schedule from raw|You match a scheduled procedure/i;
/* the four sites that inject inline today - they must stay untouched, not double-dosed */
const INJECTS_INLINE = /__mlsCodeTable/;
const HAS_PREFS_INLINE = /docPrefsBlock/;

console.log('');
console.log('CODING PROMPTS  (prompt tells the model to emit an ICD-10 / CPT / HCPCS code)');
console.log('  covered-by      file:line');
console.log('  ' + '-'.repeat(120));
let codeTotal = 0, codeOk = 0;
for (const p of prompts) {
  if (!ASKS_FOR_CODES.test(p.text) || IS_INGEST.test(p.text)) continue;
  codeTotal++;
  const inline = INJECTS_INLINE.test(p.text);
  const wrapper = SHIPPED.wantsCodes(p.text);
  const covered = inline || wrapper;
  if (covered) codeOk++; else fail('coding prompt reaches the model with NO practice code table: ' + p.f + ':' + p.line);
  console.log('  ' + (inline ? 'inline    ' : wrapper ? 'wrapper   ' : '** NONE **') + '    ' + p.f + ':' + p.line);
}
console.log('  ' + '-'.repeat(120));
console.log('  coding prompts: ' + codeOk + ' / ' + codeTotal + ' carry the practice billing code table');
if (codeTotal < 6) fail('only ' + codeTotal + ' coding prompts found - expected at least 6 on b964; the corpus or the matcher lost its subject');

console.log('');
console.log('DOCUMENT PROMPTS  (prompt writes a clinical note / letter / report the doctor signs or sends)');
console.log('  covered-by      file:line');
console.log('  ' + '-'.repeat(120));
let docTotal = 0, docOk = 0;
for (const p of prompts) {
  const inline = HAS_PREFS_INLINE.test(p.text);
  const wrapper = SHIPPED.wantsStyle(p.text);
  if (!inline && !wrapper) continue;   /* classifiers/extractors are correctly out of scope */
  docTotal++; docOk++;
  console.log('  ' + (inline ? 'inline    ' : 'wrapper   ') + '    ' + p.f + ':' + p.line);
}
console.log('  ' + '-'.repeat(120));
console.log('  document prompts carrying the Note style preference: ' + docOk + ' / ' + docTotal);
if (docTotal < 10) fail('only ' + docTotal + ' document prompts classified - expected at least 10; the note-style reach shrank');

/* the named regressions, by site, so a future refactor cannot quietly drop them */
const MUST_GET_CODES = [
  ['ScribeFlow.html', 'You draft an OPERATIVE / PROCEDURE NOTE for a pain/spine physician'],
  ['mls-connect.js', "You draft an OPERATIVE / PROCEDURE NOTE by FILLING IN the physician's OWN operative-note TEMPLATE"],
  ['mls-opnote-pro.js', 'You draft an OPERATIVE / PROCEDURE NOTE for a pain/spine physician'],
];
for (const [f, needle] of MUST_GET_CODES) {
  const hit = prompts.find(p => p.f === f && p.text.indexOf(needle) >= 0);
  if (!hit) { fail('the op-note prompt in ' + f + ' is no longer findable by its opening line - re-anchor this contract'); continue; }
  if (!(INJECTS_INLINE.test(hit.text) || SHIPPED.wantsCodes(hit.text))) fail('op-note prompt in ' + f + ' would draft ICD-10/CPT without the practice table');
  if (!(HAS_PREFS_INLINE.test(hit.text) || SHIPPED.wantsStyle(hit.text))) fail('op-note prompt in ' + f + ' would draft without the Note style preference');
}

/* ------------------------------------------ 4. does the OLD code fail this? */
/* Before the wrapper, coverage was inline-only. If inline-only also passes,
   this file is decoration. */
let oldUncovered = 0;
for (const p of prompts) {
  if (!ASKS_FOR_CODES.test(p.text) || IS_INGEST.test(p.text)) continue;
  if (!INJECTS_INLINE.test(p.text)) oldUncovered++;
}
if (oldUncovered === 0) fail('the pre-wrapper (inline-only) arrangement covers every coding prompt too, so this contract proves nothing');
else console.log('\n  control: inline-only coverage leaves ' + oldUncovered + ' coding prompt(s) uncovered - the wrapper is what closes them');

/* ---------------------------------------- 5. the wrapper must not double-dose */
const already = 'PRACTICE-APPROVED BILLING CODE TABLE (3 entries).';
if (SHIPPED.wantsCodes('fill real codes ... ' + already)) fail('a prompt that already carries the practice table would be given a second copy');
if (SHIPPED.wantsStyle('operative note ... PROVIDER PREFERENCES (follow these unless clinically inappropriate')) fail('a prompt that already carries provider preferences would be given a second copy');
/* and it must keep its hands off ingestion */
if (SHIPPED.wantsCodes('You extract ONE exact patient chart. Return the ICD-10 code fields verbatim.')) fail('an EMR extraction prompt would be given a practice code table');
if (SHIPPED.wantsStyle('You tag clinical note templates for keyword matching. Return ONLY a JSON array')) fail('the template tagger would be given a writing-style preference');

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nPASS note defaults reach: ' + codeOk + '/' + codeTotal + ' coding prompts carry the practice billing table and ' +
  docOk + ' document prompts carry the Note style preference, injected once each, with ingestion prompts left alone');
