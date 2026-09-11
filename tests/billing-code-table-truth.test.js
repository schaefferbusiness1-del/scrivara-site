/* billing-code-table-truth
 *
 * The practice billing code table, measured end to end against the SHIPPED
 * feat_mls_code_table.js (parse / splitLine / inferKind / save / load and the
 * real openEditor prefill, driven through a DOM stub), the shipped
 * hostedNotePreferences() lifted out of ScribeFlow.html, and the shipped
 * Settings status line lifted out of feat_athena_tooltip_dedupe.js.
 *
 * Four measured defects, each pinned with a control that must fail on the
 * pre-fix behaviour:
 *
 *  1 BLOCKER - reopening the Settings billing card and pressing Save DESTROYED
 *    the table. The prefill joined rows as `desc + ', ' + code` unquoted, and
 *    Save re-parsed that with the comma splitter, so
 *    "Spondylosis without myelopathy, lumbar / M47.816" came back as
 *    desc "Spondylosis without myelopathy", code "LUMBAR" (looksLikeCode
 *    accepts a 6-letter word). Save also trusted `_pending` from the last
 *    Preview, so text typed afterwards was dropped and a cleared table came
 *    back from the dead.
 *  2 BLOCKER - the header column pick was last-write-wins over a loose
 *    substring, so a superbill with a "Billing notes" column AFTER "CPT" read
 *    the prose column as the code for every row.
 *  3 MAJOR  - a semicolon/pipe sheet parsed as one cell; a header with no
 *    code-ish word was eaten as data; Excel's text-forcing apostrophe failed
 *    the shape test; CPT Category II/III and a modifier suffix had no shape.
 *  4 MAJOR  - the store writes 'icd' | 'cpt' | 'hcpcs' but /api/generate
 *    allowlists '' | 'icd10' | 'cpt', so every ICD-10 and HCPCS row reached
 *    the model untyped; and the collector cut the sheet at 100 rows while the
 *    server keeps 24, with the Settings card still claiming all N were used.
 *
 * No PHI: every code and description below is synthetic.
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
const eq = (got, want, label) => {
  if (got === want) ok(label);
  else fail(label + ' - got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
};

/* The backend's own cap. src/openai.js:
 *   const NOTE_PREF_MAX_BILLING_COUNT = 24;
 *   const NOTE_PREF_KINDS = new Set(['', 'icd10', 'cpt']);
 * An entry whose kind is outside that set is DISCARDED whole, so 'hcpcs' must
 * never be sent: an untyped row still reaches the model, a rejected one does
 * not. Move this number only together with the server's. */
const SERVER_BILLING_MAX = 24;
const SERVER_KINDS = ['', 'icd10', 'cpt'];

/* ===================================================================== DOM */
/* Rich enough to run openEditor for real: innerHTML seeds the textarea's
   value the way a browser does, and querySelector('#id') returns a STABLE
   node so the handlers the module installs can be pressed. */
function unesc(s) {
  return String(s)
    .replace(/&#10;/g, '\n').replace(/&#39;/g, "'").replace(/&rarr;/g, '->')
    .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}
function makeEl(tag) {
  const kids = Object.create(null);
  let html = '';
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '', className: '', type: '', value: '', textContent: '',
    disabled: false, hidden: false, files: null, parentNode: null,
    style: { cssText: '' }, onclick: null, onchange: null,
    appendChild(n) { return n; },
    insertBefore() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
    remove() { el.__removed = true; },
    querySelectorAll() { return []; },
    querySelector(sel) {
      const key = String(sel).replace(/^#/, '');
      if (!kids[key]) kids[key] = makeEl(key === 'mlsCtText' ? 'textarea' : 'div');
      return kids[key];
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) {
      html = String(v);
      const m = /<textarea[^>]*id="mlsCtText"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
      if (m) el.querySelector('#mlsCtText').value = unesc(m[1]);
    },
  });
  return el;
}

let modal = null;
const store = new Map();
const body = makeEl('body');
body.appendChild = function (n) { if (n && n.id === 'mlsCtModal') modal = n; return n; };

const sandbox = {
  console, JSON, Date, Math, RegExp, String, Number, Array, Object, Boolean, Error,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
  document: {
    readyState: 'complete', head: makeEl('head'), documentElement: makeEl('html'), body,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: t => makeEl(t), addEventListener() {},
  },
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  CustomEvent: function (t, d) { this.type = t; this.detail = d && d.detail; },
  FileReader: function () {}, Image: function () {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.addEventListener = () => {};
sandbox.dispatchEvent = () => {};
vm.createContext(sandbox);

try { vm.runInContext(read('feat_mls_code_table.js'), sandbox); }
catch (e) { fail('feat_mls_code_table.js did not evaluate: ' + e.message); process.exit(1); }
const api = sandbox.__mlsCodeTable;
if (!api) { fail('window.__mlsCodeTable did not install'); process.exit(1); }
ok('shipped module ' + api.version + ' loaded');

function editor() {
  modal = null;
  api.openEditor();
  if (!modal) { fail('openEditor appended no modal'); return null; }
  const m = modal;
  return {
    ta: m.querySelector('#mlsCtText'),
    countText: () => m.querySelector('#mlsCtCount').textContent,
    preview: () => m.querySelector('#mlsCtParse').onclick(),
    save: () => m.querySelector('#mlsCtSave').onclick(),
    clear: () => m.querySelector('#mlsCtClear').onclick(),
  };
}
const snapshot = () => JSON.stringify(api.load().entries);

/* ======================================================= 1. reopen -> Save */
console.log('\n1. reopening the card and pressing Save must not touch a byte');

const SHEET = [
  'Description,Code',
  '"Spondylosis without myelopathy, lumbar",M47.816',
  'Lumbar medial branch block,64493',
  '"Injection, epidural, caudal",62323',
  'Ketorolac tromethamine 15 mg,J1885',
  'Bilateral medial branch block,64493-50',
].join('\n');

api.save(api.parse(SHEET));
const uploaded = snapshot();
eq(api.count(), 5, 'the synthetic superbill uploaded as 5 rows');
eq(api.load().entries[0].desc, 'Spondylosis without myelopathy, lumbar',
  'a description holding a comma survived the upload intact');

{
  const ed = editor();
  if (ed) {
    if (!ed.ta.value) fail('the editor prefilled an empty textarea over a 5-row table');
    else ok('the editor prefilled ' + ed.ta.value.split('\n').length + ' lines');
    eq(JSON.stringify(api.parse(ed.ta.value)), uploaded,
      'the prefilled text re-parses to exactly what is stored');
    ed.save();
    eq(snapshot(), uploaded, 'reopen -> Save left every code byte-identical');
  }
}

/* CONTROL: the pre-fix prefill (an unquoted join) must corrupt the same table,
   otherwise the assertion above can never fail and proves nothing. */
{
  const legacy = api.load().entries.map(e => e.desc + ', ' + e.code).join('\n');
  const legacyRows = api.parse(legacy);
  if (JSON.stringify(legacyRows) === uploaded) {
    fail('CONTROL DEAD: the old unquoted prefill round-trips, so the quoting pin proves nothing');
  } else {
    ok('control: the old unquoted prefill still corrupts the table');
    const bad = legacyRows[0] || {};
    eq(bad.desc, 'Spondylosis without myelopathy', 'control: the description was cut at its comma');
    eq(bad.code, 'LUMBAR', 'control: its tail was promoted to a billing code');
  }
}

/* Clear must not be resurrected by a stale _pending from the open-time preview. */
{
  const ed = editor();
  if (ed) {
    ed.clear();
    ed.save();
    eq(api.count(), 0, 'Clear then Save leaves the table empty');
  }
}

/* Text typed AFTER a Preview must be what Save persists. */
{
  const ed = editor();
  if (ed) {
    ed.ta.value = 'Lumbar medial branch block, 64493';
    ed.preview();
    eq(api.parse(ed.ta.value).length, 1, 'the preview saw one row');
    ed.ta.value = 'Lumbar medial branch block, 64493\nCaudal epidural steroid injection, 62323';
    ed.save();
    eq(api.count(), 2, 'text typed after a Preview is what Save persists');
  }
}

/* ============================================ 2. header column disambiguation */
console.log('\n2. a chatty column after the real code column must not win');

{
  const three = api.parse([
    'Description,CPT,Billing notes',
    'Lumbar medial branch block,64493,prior auth required',
    'Caudal epidural steroid injection,62323,bill with fluoro',
  ].join('\n'));
  eq(three.length, 2, 'both data rows parsed under a three-column header');
  eq((three[0] || {}).code, '64493', 'the CPT column supplied the code, not "Billing notes"');
  eq((three[0] || {}).desc, 'Lumbar medial branch block', 'the Description column supplied the description');
  eq((three[1] || {}).code, '62323', 'the second row read the same column');
  /* CONTROL: the trap is only real if the later header cell does match the
     loose pattern the old last-write-wins pick used. */
  if (!/code|icd|cpt|hcpcs|billing/.test('billing notes')) {
    fail('CONTROL DEAD: "Billing notes" no longer matches the loose code pattern');
  } else ok('control: "Billing notes" still matches the loose pattern that used to win');

  /* the code column may also come FIRST */
  const swapped = api.parse('ICD-10,Diagnosis\nM47.816,Lumbar facet arthropathy');
  eq(swapped.length, 1, 'a code-first header parsed');
  eq((swapped[0] || {}).code, 'M47.816', 'a code-first header read the code from column 0');
  eq((swapped[0] || {}).desc, 'Lumbar facet arthropathy', 'a code-first header read the description from column 1');
}

/* ====================================================== 3. shapes and sniffing */
console.log('\n3. delimiters, headers, Excel junk and CPT shapes');

const one = (text, label) => {
  const rows = api.parse(text);
  if (rows.length !== 1) { fail(label + ' - expected 1 row, got ' + rows.length); return {}; }
  return rows[0];
};

/* reported, never thrown: a suite that crashes stops measuring everything after it */
const sniff = t => (typeof api.sniffDelim === 'function' ? api.sniffDelim(t) : '(no sniffDelim)');
eq(sniff('Caudal epidural steroid injection;62323'), ';', 'a semicolon sheet sniffs as semicolon');
eq(sniff('Caudal epidural steroid injection|62323'), '|', 'a pipe sheet sniffs as pipe');
eq(sniff('Caudal epidural steroid injection\t62323'), '\t', 'a tab sheet still sniffs as tab');
eq(sniff('"Injection, epidural, caudal",62323'), ',', 'a quoted comma sheet still sniffs as comma');
/* a comma inside a description must not outvote the sheet's real delimiter */
eq(sniff('Spondylosis, lumbar\tM47.816'), '\t', 'a comma in a description does not beat a real tab');
eq(sniff('"Injection, epidural, caudal";62323'), ';', 'commas inside quotes do not beat a real semicolon');
eq(sniff('Pain | chronic, M47.816'), ',', 'a pipe inside a description does not beat the comma sheet');
eq(api.parse('Spondylosis, lumbar\tM47.816')[0].desc, 'Spondylosis, lumbar',
  'a tab row keeps a comma inside its description');
eq((api.parse('"Injection, epidural, caudal";62323')[0] || {}).code, '62323',
  'a quoted semicolon row yields its code');
eq((api.parse('Pain | chronic, M47.816')[0] || {}).desc, 'Pain | chronic',
  'a pipe inside a comma row stays part of the description');

eq(one('Caudal epidural steroid injection;62323', 'semicolon').code, '62323', 'a semicolon row yields its code');
eq(one('Caudal epidural steroid injection|62323', 'pipe').code, '62323', 'a pipe row yields its code');
eq(one('Caudal epidural steroid injection\t62323', 'tab').code, '62323', 'a tab row yields its code');

{
  /* a header whose second cell carries no code-ish word at all */
  const rows = api.parse('Diagnosis,Value\nLumbar facet arthropathy,M47.816');
  eq(rows.length, 1, 'a header with no code-ish word was recognised as a header');
  eq((rows[0] || {}).desc, 'Lumbar facet arthropathy', 'the header row did not become a data row');
  /* CONTROL: the header cell really is code-shaped enough to have been kept */
  if (!/^[A-Z0-9][A-Z0-9.\-]{2,7}$/i.test('Value')) {
    fail('CONTROL DEAD: "Value" no longer passes the loose code shape that used to mint it');
  } else ok('control: "Value" still passes the loose code shape, so the header really was at risk');
  /* and a first row that IS data must still be kept even with a desc-ish word */
  const kept = api.parse('Post-procedure pain syndrome,G89.18');
  eq(kept.length, 1, 'a data first row containing "procedure" is still data, not a header');
}

eq(one("Lumbar medial branch block,'64493", 'excel apostrophe').code, '64493',
  "Excel's text-forcing apostrophe is stripped before the shape test");
eq(one('Lumbar medial branch block;"64493"', 'quoted tsv cell').code, '64493',
  'a quoted cell on a non-comma sheet is unwrapped before the shape test');

eq(api.inferKind('0775T'), 'cpt', 'CPT Category III (0775T) infers as cpt');
eq(api.inferKind('1125F'), 'cpt', 'CPT Category II (1125F) infers as cpt');
eq(api.inferKind('0002M'), 'cpt', 'a CPT MAAA code (0002M) infers as cpt');
eq(api.inferKind('0016U'), 'cpt', 'a CPT PLA code (0016U) infers as cpt');
eq(api.inferKind('64493'), 'cpt', 'CPT Category I still infers as cpt');
eq(api.inferKind('M47.816'), 'icd', 'ICD-10 still infers as icd');
eq(api.inferKind('J1885'), 'hcpcs', 'HCPCS still infers as hcpcs');

eq(api.inferKind('64493-50'), 'cpt', 'a modifier suffix does not hide the base CPT');
eq(api.inferKind('J1885-JW'), 'hcpcs', 'a modifier suffix does not hide the base HCPCS');
{
  const mod = one('Bilateral medial branch block,64493-50', 'modifier row');
  eq(mod.code, '64493-50', 'the modifier stays part of the practice-approved code');
  eq(mod.kind, 'cpt', 'the modified row is typed from its base code');
  eq(mod.modifier, '50', 'the modifier is kept beside the entry');
}

/* ================================================ 4. what actually travels */
console.log('\n4. the hosted payload and the Settings line must agree with the server');

const SHELLS = ['1pScribeFlow.html', 'ScribeFlow.html', '1p/index.html', 'cloned/index.html'];
SHELLS.forEach((f) => {
  const src = read(f);
  if (src.indexOf('const HOSTED_BILLING_MAX=' + SERVER_BILLING_MAX + ';') < 0) {
    fail(f + ' does not stop collecting billing codes at the server cap');
  }
  if (/out\.billingCodes\.length<100/.test(src)) {
    fail(f + ' still collects 100 billing codes the server throws away');
  }
  if (/const kind=\(rawKind==='icd10'\|\|rawKind==='cpt'\)\?rawKind:''/.test(src)) {
    fail(f + " still maps the store's kinds with the pre-fix allowlist");
  }
});
ok('all four shells carry the same cap and mapping (the derive kept the twins together)');

/* run the SHIPPED collector over the REAL store */
{
  const sf = read('ScribeFlow.html');
  const s = sf.indexOf('function hostedNotePreferences(){');
  const e = sf.indexOf('\n\n/* =========================================================', s);
  if (s < 0 || e < 0) fail('could not isolate hostedNotePreferences() in ScribeFlow.html');
  else {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const kind = i % 3;
      rows.push('Practice row ' + i + ',' + (
        kind === 0 ? ('M' + (10 + i) + '.' + (i % 10))
          : kind === 1 ? String(64400 + i)
            : ('J' + (1000 + i))));
    }
    api.save(api.parse(rows.join('\n')));
    eq(api.count(), 40, 'a 40-row synthetic practice table is stored');
    const stored = api.load().entries;
    eq((stored[0] || {}).kind, 'icd', "the store really writes 'icd'");
    eq((stored[1] || {}).kind, 'cpt', "the store really writes 'cpt'");
    eq((stored[2] || {}).kind, 'hcpcs', "the store really writes 'hcpcs'");

    vm.runInContext(sf.slice(s, e) + '\nthis.__billing=hostedNotePreferences();', sandbox);
    const p = sandbox.__billing;
    if (!p || !Array.isArray(p.billingCodes)) fail('hostedNotePreferences() returned no billing codes');
    else {
      const sent = p.billingCodes;
      eq(sent.length, SERVER_BILLING_MAX,
        'the collector stops exactly where /api/generate stops (' + SERVER_BILLING_MAX + ')');
      eq(sent.filter(v => SERVER_KINDS.indexOf(v.kind) < 0).length, 0,
        'every kind sent is one the server accepts');
      eq((sent[0] || {}).kind, 'icd10', "a stored 'icd' row travels as the server's 'icd10'");
      eq((sent[1] || {}).kind, 'cpt', "a stored 'cpt' row keeps its kind");
      eq((sent[2] || {}).kind, '', "a stored 'hcpcs' row travels untyped, not dropped");
      eq((sent[2] || {}).desc, 'Practice row 2', 'the untyped HCPCS row still carries its description');
      eq(sent.filter(v => v.kind === 'icd10').length, 8,
        'all eight ICD rows inside the cap are typed (none silently untyped)');
    }
  }
}

/* the Settings status line, lifted verbatim out of the shipped module */
{
  const ded = read('feat_athena_tooltip_dedupe.js');
  const maxLine = /var HOSTED_BILLING_MAX = (\d+);/.exec(ded);
  if (!maxLine) fail('feat_athena_tooltip_dedupe.js no longer declares HOSTED_BILLING_MAX');
  else eq(Number(maxLine[1]), SERVER_BILLING_MAX, 'the Settings card and the collector name the same limit');

  function liftFn(src, sig, label) {
    const i = src.indexOf(sig);
    if (i < 0) { fail('could not find ' + label); return ''; }
    if (src.indexOf(sig, i + 1) >= 0) { fail(label + ' is ambiguous'); return ''; }
    let d = 0, started = false, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') { d++; started = true; }
      else if (src[j] === '}') { d--; if (started && d === 0) { j++; break; } }
    }
    return src.slice(i, j);
  }
  const status = { textContent: '' };
  const cardCtx = vm.createContext({
    console,
    W: sandbox,
    byId: id => (id === 'mlsSetCodeTableStatus' ? status : null),
    safe: (fn, d) => { try { return fn(); } catch (x) { return d; } },
    String, Number,
  });
  const cardSrc = [
    'var HOSTED_BILLING_MAX = ' + (maxLine ? maxLine[1] : SERVER_BILLING_MAX) + ';',
    liftFn(ded, 'function billingCodesCount() {', 'billingCodesCount()'),
    liftFn(ded, 'function refreshBillingCodesCard() {', 'refreshBillingCodesCard()'),
    'this.refresh=refreshBillingCodesCard;',
  ].join('\n');
  try { vm.runInContext('(function(){' + cardSrc + '}).call(globalThis);', cardCtx); }
  catch (err) { fail('the shipped Settings card helpers did not evaluate: ' + err.message); }

  if (typeof cardCtx.refresh === 'function') {
    cardCtx.refresh();                                   /* 40 rows are stored */
    const over = status.textContent;
    if (over.indexOf('40') < 0) fail('the Settings line no longer states the real count');
    else if (over.indexOf('first ' + SERVER_BILLING_MAX) < 0) {
      fail('the Settings line still implies all 40 codes reach a visit note: ' + JSON.stringify(over));
    } else ok('over the limit the Settings line says: ' + JSON.stringify(over));

    api.save(api.parse('Lumbar medial branch block, 64493\nCaudal epidural steroid injection, 62323'));
    cardCtx.refresh();                                   /* now under the limit */
    const under = status.textContent;
    if (under.indexOf('first ' + SERVER_BILLING_MAX) >= 0) {
      fail('a 2-row table was told it gets truncated: ' + JSON.stringify(under));
    } else ok('under the limit the Settings line stays unqualified');
    if (under === over) fail('CONTROL DEAD: the status line never changed between 40 rows and 2');
  }
}

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nPASS billing code table: a reopen+Save is byte-neutral, the real code column wins, semicolon/pipe/Excel/Category II-III/modifier rows parse, and every row that travels to /api/generate carries a kind the server accepts within the cap the Settings card now states');
