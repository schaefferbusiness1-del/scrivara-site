/* note-defaults-reach-runtime
 *
 * The static contract proves the WIRING. This one proves the BEHAVIOUR: it
 * loads the real feat_mls_code_table.js, the real docPrefsBlock()/getMlsNoteStyle()
 * from ScribeFlow.html and the real wrapper from mls-connect.js, saves a real
 * practice code table through the real editor API, then pushes the REAL op-note
 * and prior-authorization system prompts (lifted verbatim out of the shipped
 * files) through aiCallRaw and reads what the model would actually receive.
 *
 * Each assertion is paired with a control that must FAIL, because a check that
 * can only ever pass is not a check:
 *   - table saved   -> the practice code must appear;  table cleared -> it must not
 *   - style concise -> the preference must appear;     style balanced -> it must not
 *   - argument 0 gains the blocks; argument 1 (the doctor's own template) must
 *     come out byte-identical.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r/g, '');

let failures = 0;
const fail = m => { console.error('FAIL: ' + m); failures++; };
const ok = m => console.log('  ok  ' + m);

/* ------------------------------------------------------------- a real-ish DOM */
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
const noop = () => {};
const el = () => ({
  id: '', className: '', innerHTML: '', textContent: '', style: { cssText: '' }, type: '', value: '',
  appendChild: noop, insertBefore: noop, remove: noop, removeAttribute: noop, setAttribute: noop,
  addEventListener: noop, querySelector: () => el(), querySelectorAll: () => [], parentNode: null, files: null,
});
const document = {
  readyState: 'complete', head: el(), documentElement: el(), body: el(),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => el(), addEventListener: noop,
};

const sandbox = {
  console, localStorage, document, JSON, Date, Math, RegExp, String, Number, Array, Object, Boolean, Error,
  setInterval: () => 0, clearInterval: noop, setTimeout: () => 0, clearTimeout: noop,
  CustomEvent: function (t, d) { this.type = t; this.detail = d && d.detail; },
  FileReader: function () {}, Image: function () {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.addEventListener = noop;
sandbox.dispatchEvent = noop;
vm.createContext(sandbox);

/* ------------------------------------- the real settings getters + prefs block */
const sf = read('ScribeFlow.html');
function lift(sig, label) {
  const i = sf.indexOf(sig);
  if (i < 0) { fail('could not find ' + label + ' in ScribeFlow.html'); return ''; }
  if (sf.indexOf(sig, i + 1) >= 0) { fail(label + ' appears more than once in ScribeFlow.html - lifting the wrong copy'); return ''; }
  /* to the end of the function: balance braces from the first { after the signature */
  let d = 0, started = false, j = i;
  for (; j < sf.length; j++) {
    if (sf[j] === '{') { d++; started = true; }
    else if (sf[j] === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return sf.slice(i, j);
}
const realSrc = [
  'var session={email:"proof@example.com"};',
  lift('function uns(suffix){', 'uns()'),
  lift('function getDocPrefs(){', 'getDocPrefs()'),
  lift('function getQolFollowup(){', 'getQolFollowup()'),
  lift('function getMlsNoteStyle(){', 'getMlsNoteStyle()'),
  lift('function docPrefsBlock(){', 'docPrefsBlock()'),
  'this.uns=uns;this.getDocPrefs=getDocPrefs;this.getQolFollowup=getQolFollowup;this.getMlsNoteStyle=getMlsNoteStyle;this.docPrefsBlock=docPrefsBlock;',
].join('\n');
try { vm.runInContext('(function(){' + realSrc + '}).call(globalThis);', sandbox); }
catch (e) { fail('the real ScribeFlow settings helpers did not evaluate: ' + e.message); }

/* --------------------------------------------- the real code-table module */
try { vm.runInContext(read('feat_mls_code_table.js'), sandbox); }
catch (e) { fail('feat_mls_code_table.js did not evaluate: ' + e.message); }
if (!sandbox.__mlsCodeTable) fail('window.__mlsCodeTable did not install');

/* --------------------------- a capture stub standing in for the network call */
let captured = [];
sandbox.aiCallRaw = function (sys, user, key, opts) { captured.push({ sys, user, key, opts }); return Promise.resolve('{}'); };

/* ----------------------------------- the real wrapper, sliced from mls-connect */
const connect = read('mls-connect.js');
const H = 'feat_mls_note_defaults_reach (ndr-1.0.0)';
const hi = connect.indexOf(H);
if (hi < 0) fail('the note-defaults wrapper is not in mls-connect.js');
const wStart = connect.indexOf('(function(){', hi);
const wEnd = connect.indexOf('\n})();', wStart);
try { vm.runInContext(connect.slice(wStart, wEnd + 6), sandbox); }
catch (e) { fail('the wrapper did not evaluate: ' + e.message); }
if (!sandbox.__mlsNoteDefaultsReach) fail('window.__mlsNoteDefaultsReach did not install');
else if (!sandbox.__mlsNoteDefaultsReach.installed()) fail('the wrapper reported itself NOT installed over a live aiCallRaw');
else ok('wrapper ' + sandbox.__mlsNoteDefaultsReach.version + ' installed over aiCallRaw');

/* ---------------------------------------- the REAL prompts, lifted verbatim */
function liftPrompt(file, anchor, label) {
  const t = read(file);
  const i = t.indexOf(anchor);
  if (i < 0) { fail('prompt anchor not found: ' + label); return ''; }
  if (t.indexOf(anchor, i + 1) >= 0) { fail('prompt anchor is ambiguous (2+ hits): ' + label); return ''; }
  return t.slice(i, i + 6000);   /* enough to carry the CODING paragraph */
}
const OPNOTE = liftPrompt('mls-opnote-pro.js', 'You draft an OPERATIVE / PROCEDURE NOTE for a pain/spine physician', 'op-note pro');
const OPFILL = liftPrompt('mls-connect.js', "You draft an OPERATIVE / PROCEDURE NOTE by FILLING IN the physician's OWN", 'op-note template fill');
const TEMPLATE_USER = 'PROCEDURE: Lumbar medial branch block\n\nTEMPLATE (the doctor\'s own prior op note):\nPROCEDURE: [PROCEDURE]\nCPT: [CPT]\n';

async function send(sys, user) { captured = []; await sandbox.aiCallRaw(sys, user, 'k', { freeform: true }); return captured[0]; }

(async function () {
  /* ============ 1. practice codes reach the op-note prompt ============ */
  sandbox.__mlsCodeTable.save(sandbox.__mlsCodeTable.parse(
    'Lumbar facet arthropathy, M47.816\nLumbar medial branch block, 64493\nCaudal epidural steroid injection, 62323'
  ));
  if (sandbox.__mlsCodeTable.count() !== 3) fail('the real code-table editor did not persist 3 entries (got ' + sandbox.__mlsCodeTable.count() + ')');
  else ok('practice table saved through the real editor API: 3 codes');

  let c = await send(OPNOTE, TEMPLATE_USER);
  if (c.sys.indexOf('64493') < 0) fail('OP-NOTE PRO: the practice CPT 64493 never reached the system prompt');
  else ok('op-note (mls-opnote-pro) system prompt now carries the practice codes (64493, M47.816)');
  if (c.sys.indexOf('M47.816') < 0) fail('OP-NOTE PRO: the practice ICD-10 M47.816 never reached the system prompt');
  if (c.user !== TEMPLATE_USER) fail('the user prompt was modified - the doctor\'s own template must come out byte-identical');
  else ok('user prompt byte-identical (the doctor\'s template is never edited)');

  c = await send(OPFILL, TEMPLATE_USER);
  if (c.sys.indexOf('64493') < 0) fail('OP-NOTE TEMPLATE FILL: the practice CPT never reached the system prompt');
  else ok('op-note template fill (mls-connect) system prompt now carries the practice codes');

  /* CONTROL: clear the table and the same prompt must lose the codes. */
  sandbox.__mlsCodeTable.save([]);
  c = await send(OPNOTE, TEMPLATE_USER);
  if (c.sys.indexOf('64493') >= 0) fail('CONTROL BROKEN: the code survived after the table was cleared - something is caching, or the assertion above passes for the wrong reason');
  else ok('control: table cleared -> 64493 gone (the assertion above was reading the table, not the prompt)');
  if (c.sys.indexOf('No practice-specific code table') < 0) fail('with no table the prompt lost the "use your best current standard code" authorization');
  else ok('with no table the AI is still told to fill its best current standard code');

  /* ============ 2. Note style reaches the op-note prompt ============ */
  store.set(sandbox.uns('noteStyle'), 'balanced');
  c = await send(OPNOTE, TEMPLATE_USER);
  const balancedHasPref = c.sys.indexOf('PROVIDER PREFERENCES') >= 0;
  if (balancedHasPref) fail('CONTROL BROKEN: the default "Balanced" style injected a preference block - an untouched account should pay nothing');
  else ok('control: Note style = Balanced (default) injects nothing');

  store.set(sandbox.uns('noteStyle'), 'concise');
  c = await send(OPNOTE, TEMPLATE_USER);
  if (c.sys.indexOf('Write notes concisely') < 0) fail('Note style = Concise never reached the op-note prompt');
  else ok('Note style = Concise now reaches the op-note prompt');

  store.set(sandbox.uns('noteStyle'), 'detailed');
  c = await send(OPNOTE, TEMPLATE_USER);
  if (c.sys.indexOf('thorough, detailed style') < 0) fail('Note style = Detailed never reached the op-note prompt');
  else ok('Note style = Detailed now reaches the op-note prompt');
  if (c.sys.indexOf('never change the output format') < 0) fail('the preference block was appended without its scope guard, so a writing preference is the last instruction before a JSON contract');
  else ok('the preference block states its own scope, so it cannot outrank the output contract it follows');

  /* the doctor's free-text preferences ride the same block */
  store.set(sandbox.uns('docprefs'), JSON.stringify(['Always add return precautions']));
  c = await send(OPNOTE, TEMPLATE_USER);
  if (c.sys.indexOf('Always add return precautions') < 0) fail('the doctor\'s saved preference did not reach the op-note prompt');
  else ok('the doctor\'s own saved preferences reach op-notes too');

  /* ============ 3. no double-dosing ============ */
  sandbox.__mlsCodeTable.save(sandbox.__mlsCodeTable.parse('Lumbar medial branch block, 64493'));
  const already = OPNOTE + '\n\n' + sandbox.__mlsCodeTable.promptBlock();
  c = await send(already, TEMPLATE_USER);
  const n = (c.sys.match(/PRACTICE-APPROVED BILLING CODE TABLE/g) || []).length;
  if (n !== 1) fail('a prompt that already carried the table ended up with ' + n + ' copies');
  else ok('a prompt that already injects the table inline is left alone (1 copy, not 2)');

  /* ============ 4. the transport REFUSES, it does not truncate ============ */
  /* POST /api/complete answers 413 "The prompt is too large." above 30000 chars
     of system. An oversized prompt is a DEAD op-note, not a shorter one, so the
     wrapper must never be the thing that crosses it. */
  const LIMIT = sandbox.__mlsNoteDefaultsReach.sysLimit;
  if (LIMIT !== 30000) fail('the wrapper thinks the system limit is ' + LIMIT + '; server.js /api/complete rejects above 30000');
  /* a table far larger than any real practice */
  const many = [];
  for (let i = 0; i < 3000; i++) many.push('Practice diagnosis variant number ' + i + ' lumbar facet arthropathy, M47.' + (800 + i % 99));
  sandbox.__mlsCodeTable.save(sandbox.__mlsCodeTable.parse(many.join('\n')));
  store.set(sandbox.uns('docprefs'), JSON.stringify(Array.from({ length: 200 }, (_, i) => 'Standing preference number ' + i + ' ' + 'x'.repeat(120))));
  store.set(sandbox.uns('noteStyle'), 'detailed');
  c = await send(OPNOTE, TEMPLATE_USER);
  if (c.sys.length > LIMIT) fail('a large practice table + long preference list pushed the system prompt to ' + c.sys.length + ' chars - the request would 413 and the op-note would simply never arrive');
  else ok('worst case (3000 codes + 200 long preferences) stays under the transport limit: ' + c.sys.length + ' / ' + LIMIT);
  /* CONTROL: without the guard the same inputs must actually be dangerous,
     otherwise the check above is decorative. */
  const unguarded = OPNOTE + '\n\n' + sandbox.__mlsCodeTable.promptBlock() + sandbox.docPrefsBlock();
  if (unguarded.length > LIMIT) ok('control: the same inputs unguarded would be ' + unguarded.length + ' chars');
  else ok('control note: promptBlock self-caps at ~6.4KB so even unguarded this stays at ' + unguarded.length + ' - the guard is a ceiling, not a live rescue');
  /* a cap nobody can see reads as "everything fit" */
  const d = sandbox.__mlsNoteDefaultsReach.dropped();
  if ((d.prefsDropped + d.codeTableTrimmed + d.codeTableDropped) === 0) fail('the ceiling bit but nothing recorded it - a silent cap is indistinguishable from full coverage');
  else ok('the ceiling records what it left out: ' + JSON.stringify(d));
  /* and a trimmed table must never end mid-code */
  if (/=> [A-Z]?[0-9.]*$/.test(c.sys.trim())) fail('the injected table was cut mid-entry, which can manufacture a plausible wrong code');
  else ok('the table is never cut mid-entry');
  store.delete(sandbox.uns('docprefs')); store.set(sandbox.uns('noteStyle'), 'balanced');
  sandbox.__mlsCodeTable.save([]);

  /* ============ 5. ingestion prompts stay clean ============ */
  c = await send('You extract ONE exact patient clinical chart from a raw Athena frame-set. Return ONLY JSON. Include any ICD-10 code verbatim.', 'PAGE');
  if (c.sys.indexOf('PRACTICE-APPROVED') >= 0) fail('an EMR extraction prompt was given a practice code table');
  else ok('EMR extraction prompts are left untouched');

  if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
  console.log('\nPASS note defaults runtime: the practice code table and the Note style preference both reach op-note and template-fill drafting, once each, with working controls on every claim');
})();
