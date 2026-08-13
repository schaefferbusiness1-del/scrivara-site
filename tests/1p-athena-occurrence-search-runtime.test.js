'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const file = path.join(root, '1p-feat_mls_athena_occurrence.js');
const source = fs.readFileSync(file, 'utf8');
let passed = 0;
function ok(v, m) { assert.ok(v, m); passed++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); passed++; }

const listeners = {};
const installScript = { getAttribute(name) { return name === 'data-mls-install-token' ? 'test-occurrence-token' : (name === 'data-mls-asset' ? 'feat_mls_athena_occurrence.js' : null); } };
const document = {
  readyState: 'loading', currentScript: installScript, documentElement: {}, head: { appendChild() {} },
  addEventListener(type, fn) { listeners[type] = fn; },
  getElementById() { return null; }, createElement() { return { style: {}, setAttribute() {} }; }
};
class MutationObserver { observe() {} disconnect() {} }
const window = { __MLS_P1_PREVIEW: { enabled: true }, __mlsP1AthenaOccurrenceLoader: { installed: true, version: 'p1-athena-occurrence-1.0.0', installToken: 'test-occurrence-token' }, addEventListener() {}, removeEventListener() {}, postMessage() {} };
const context = vm.createContext({ window, document, MutationObserver, Promise, Date, Math, setTimeout, clearTimeout, setInterval, clearInterval });
vm.runInContext(source, context, { filename: file });
const api = window.__mlsAthenaOccurrence;
ok(api && api.installed, 'occurrence owner did not install');
eq(api.version, 'p1-athena-occurrence-1.0.0', 'unexpected occurrence owner version');

let q = api._parseQuery('Who had MILD procedure CPT 62330, all done at SCCC?', '');
eq(q.codes.join(','), '62330', 'natural query did not extract the exact CPT');
eq(q.facility.name, 'POSM ASC Chester County', 'SCCC did not resolve to the exact facility');
eq(q.facility.departmentId, '744', 'SCCC did not resolve to Athena department 744');
ok(q.keywords.join(' ').includes('mild'), 'natural query dropped its descriptive keyword');
eq(api._resolveFacility('POSM ASC Chester County Hospital').key, 'sccc_hospital', 'hospital was collapsed into SCCC');
eq(api._resolveFacility('Chester County Hospital').name, 'POSM ASC Chester County Hospital', 'hospital alias was misresolved');

const mixed = [
  'POSM ASC Chester County 07/01/2026 Alpha, Alice Patient ID: 1001 01/02/1980 Claim ID: CLM-A Procedure Code 11111 MILD',
  'POSM ASC Chester County Hospital 07/02/2026 Alpha, Alice Patient ID: 1001 01/02/1980 Claim ID: CLM-B Procedure Code 62330 MILD'
].join('\n');
let rows = api._parseRows(mixed);
eq(rows.length, 2, 'parser merged or dropped separate patient occurrences');
eq(api._filterRows(rows, q).length, 0, 'different-facility/different-code rows joined into a false positive');
const flattened = 'POSM ASC Chester County 07/01/2026 Alpha, Alice Patient ID 1001 01/02/1980 Claim A 11111 Other Facility 07/02/2026 Alpha, Alice Patient ID 1001 01/02/1980 Claim B 62330';
eq(api._filterRows(api._parseRows(flattened), q).length, 0, 'flattened mixed occurrences cross-joined CPT and facility');
const idAsCpt = 'POSM ASC Chester County 07/01/2026 Alpha, Alice Patient ID 62330 01/02/1980 Claim A Procedure Code 11111';
rows = api._parseRows(idAsCpt);
eq(rows.length, 1, 'labeled row with a five-digit patient ID was dropped');
eq(rows[0].codes.join(','), '11111', 'five-digit patient ID was misclassified as CPT');
const pipeRow = api._parseRows('POSM ASC Chester County | 07/05/2026 | Delta, Drew / 4004 / 04/05/1983 | CLM-E | 62330')[0];
eq(pipeRow.name, 'Delta, Drew', 'column-like patient composite name was not parsed exactly');
eq(pipeRow.patientId, '4004', 'column-like patient ID was not retained');
eq(pipeRow.claimId, 'CLM-E', 'column-like claim ID was not retained');
const labeledName = api._parseRows('POSM ASC Chester County 07/03/2026 Bravo, Bailey Patient ID: 2002 02/03/1981 Claim ID: CLM-C Procedure Code 62330')[0];
eq(labeledName.name, 'Bravo, Bailey', 'Patient ID label leaked into the parsed name');
const collapsedMiddle = api._parseRows('POSM ASC Chester County 07/05/2026 Example, Erin A. / 4004 / 04/05/1983 CLM-E 62330, 77003 MILD procedure')[0];
eq(collapsedMiddle.name, 'Example, Erin A.', 'collapsed middle-initial name was dropped');
eq(collapsedMiddle.codes.join(','), '62330,77003', 'complete collapsed procedure-code cell was not parsed');
const collapsedSuffix = api._parseRows('POSM ASC Chester County 07/05/2026 Example, Erin Jr. / 4004 / 04/05/1983 CLM-E 62330')[0];
eq(collapsedSuffix.name, 'Example, Erin Jr.', 'collapsed suffix name was dropped');
const collapsedApostrophe = api._parseRows('POSM ASC Chester County 07/05/2026 O\u2019Example, Erin / 4004 / 04/05/1983 CLM-E 62330')[0];
eq(collapsedApostrophe.name, "O'Example, Erin", 'smart-apostrophe surname was truncated or changed incorrectly');
const infantRow = api._parseRows('POSM ASC Chester County 01/15/2026 Baby, Example / 4004 / 01/01/2026 CLM-E 62330')[0];
eq(infantRow.svc, '01/15/2026', 'same-year DOB replaced the occurrence DOS');
eq(infantRow.dob, '01/01/2026', 'same-year patient DOB was not retained');
eq(api._parseRows('POSM ASC Chester County 07/05/2026 Example, Erin / 4004 / 04/05/1983 CLM-E 62330 OTHER OCCURRENCE 11111').length, 0, 'ambiguous collapsed tail was not rejected');

const exact = [
  'POSM ASC Chester County 07/03/2026 Bravo, Bailey Patient ID: 2002 02/03/1981 Claim ID: CLM-C Procedure Code 11111 MILD procedure',
  'POSM ASC Chester County 07/04/2026 Casey, Cameron Patient ID: 3003 03/04/1982 Claim ID: CLM-D Procedure Code 62330 unrelated label'
].join('\n');
rows = api._parseRows(exact);
let hit = api._filterRows(rows, q);
eq(hit.length, 1, 'exact CPT was treated as keyword OR');
eq(hit[0].codes[0], '62330', 'wrong-code row survived the exact CPT gate');
const keywordOnly = { codes: [], keywords: ['mild procedure'], facility: q.facility, from: '', to: '' };
hit = api._filterRows(rows, keywordOnly);
eq(hit.length, 1, 'keyword-only mode did not retain its OR semantics');
ok(hit[0].codes.includes('11111'), 'keyword-only mode selected the wrong synthetic occurrence');

const duplicates = [
  'POSM ASC Chester County 07/05/2026 Delta, Drew Patient ID: 4004 04/05/1983 Claim ID: CLM-E Procedure Code 62330',
  'POSM ASC Chester County 07/05/2026 Delta, Drew Patient ID: 4004 04/05/1983 Claim ID: CLM-E Procedure Code 62330',
  'POSM ASC Chester County 07/06/2026 Delta, Drew Patient ID: 4004 04/05/1983 Claim ID: CLM-F Procedure Code 62330'
].join('\n');
hit = api._filterRows(api._parseRows(duplicates), q);
eq(hit.length, 3, 'occurrence parser prematurely de-duplicated claim rows');
const displayed = api._dedupeForDisplay(hit);
eq(displayed.length, 1, 'same verified patient was duplicated in display');
eq(displayed[0].occurrenceCount, 2, 'duplicate claim was counted as a distinct occurrence');
eq(api._filterRows([], q).length, 0, 'empty result created a synthetic match');

let receipt = api._retrievalReceipt({ text: 'short', pages: 2 });
eq(receipt.complete, false, 'legacy extension response was called complete without terminal proof');
eq(receipt.reason, 'legacy-completeness-unverified', 'legacy incomplete reason is not explicit');
receipt = api._retrievalReceipt({ text: 'short', pages: 60, complete: true });
eq(receipt.complete, false, 'max-page response was called complete');
eq(receipt.truncated, true, 'page-limit response was not flagged truncated');
receipt = api._retrievalReceipt({ text: 'short', pages: 1, complete: true });
eq(receipt.complete, true, 'future explicit closed-page receipt cannot become complete');

const baseRow = { name: 'Echo Example', dob: '05/06/1984', patientId: 'ATH-5005' };
let decision = api._identityDecision(baseRow, [{ id: 'local-a', athenaId: 'ATH-5005', name: 'Example, Echo', dob: '05/06/1984' }]);
eq(decision.action, 'already', 'matching Athena ID was not preferred for an existing patient');
eq(decision.via, 'athena-id', 'existing-patient receipt hid the preferred identity route');
decision = api._identityDecision(baseRow, [{ id: 'local-a', athenaId: 'ATH-5005', name: 'Wrong Person', dob: '05/06/1984' }]);
eq(decision.action, 'review', 'Athena ID/name conflict did not fail into identity review');
decision = api._identityDecision({ name: 'Foxtrot Fixture', dob: '06/07/1985' }, [
  { id: 'one', name: 'Fixture, Foxtrot', dob: '06/07/1985' }, { id: 'two', name: 'Foxtrot Fixture', dob: '06/07/1985' }
]);
eq(decision.action, 'review', 'duplicate name+DOB patients were silently selected');
eq(api._identityDecision({ name: 'Golf Generated', dob: '07/08/1986' }, []).action, 'import', 'new exact name+DOB candidate was refused before verification');
eq(api._identityDecision({ name: 'Golf Generated', dob: '' }, []).action, 'review', 'name-only candidate entered the import path');

const completeRetrieval = { complete: true };
let verdict = api._batchVerdict(2, [0, 1], { 0: { code: 'imported' }, 1: { code: 'already' } }, completeRetrieval, false);
eq(verdict.complete, true, 'full successful selection did not complete');
eq(verdict.selectedComplete, true, 'successful selected batch was not distinguished from coverage');
verdict = api._batchVerdict(2, [0], { 0: { code: 'imported' } }, completeRetrieval, false);
eq(verdict.complete, false, 'partial selection was reported as the complete result set');
eq(verdict.selectedComplete, true, 'safe partial selection was mislabeled as a failed selected pull');
eq(verdict.reason, 'partial-selection', 'partial-selection reason was lost');
verdict = api._batchVerdict(2, [0, 1], { 0: { code: 'imported' }, 1: { code: 'failed' } }, completeRetrieval, false);
eq(verdict.complete, false, 'one failed patient left the batch complete');
eq(verdict.reason, 'patient-pull-incomplete', 'failed patient did not yield an incomplete receipt');
verdict = api._batchVerdict(0, [], {}, completeRetrieval, false);
eq(verdict.complete, false, 'zero selected was reported complete');
eq(verdict.selectedComplete, false, 'zero selected was called a finished selected pull');
verdict = api._batchVerdict(2, [0, 1], { 0: { code: 'imported' }, 1: { code: 'already' } }, { complete: false }, false);
eq(verdict.complete, false, 'incomplete retrieval was hidden by a successful selected pull');
eq(api._batchVerdict(2, [0, 1], { 0: { code: 'imported' } }, completeRetrieval, true).reason, 'cancelled', 'cancel did not dominate the batch receipt');
verdict = api._batchVerdict(3, [2], { 0: { code: 'imported' }, 1: { code: 'failed' }, 2: { code: 'already' } }, completeRetrieval, false);
eq(verdict.counts.already, 1, 'retry batch counted a prior selection status');
eq(verdict.counts.imported, 0, 'retry batch leaked prior imported status into its receipt');

const run1 = api._makeRun('search', {});
ok(run1 && api._currentRun(run1), 'single-flight lease did not start');
eq(api._makeRun('search', {}), null, 'second concurrent request acquired the lease');
eq(api.cancel(), true, 'active request could not be cancelled');
ok(run1.cancelled, 'cancel did not mark the active request');
eq(api._finishRun(run1), true, 'cancelled request could not drain its lease');
const run2 = api._makeRun('search', {});
ok(run2 && !api._currentRun(run1), 'stale request remained current after a new lease');
api._finishRun(run2);

const startedAt = Date.now() - 100, deadlineAt = Date.now() + 10000;
const goodReceipt = { kind: 'athena-chart-coverage', complete: true, truncated: false, readerVersion: '2.9.19-chart-r3', requestId: 'req-1', capturedAt: Date.now(), identityObserved: true, identityVia: 'banner-dob', expectedClinicalFrames: 2, readClinicalFrames: 2, boundClinicalFrames: 2, unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0, textChars: 4 };
eq(api._chartReceiptComplete({ requestId: 'req-1', text: 'four', receipt: goodReceipt }, 'req-1', startedAt, deadlineAt), true, 'complete exact-chart receipt was rejected');
eq(api._chartReceiptComplete({ requestId: 'stale', text: 'four', receipt: goodReceipt }, 'req-1', startedAt, deadlineAt), false, 'stale chart response was accepted');
eq(api._chartReceiptComplete({ requestId: 'req-1', text: 'four', receipt: { ...goodReceipt, truncated: true } }, 'req-1', startedAt, deadlineAt), false, 'truncated chart read was accepted');
eq(api._chartReceiptComplete({ requestId: 'req-1', text: 'four', receipt: { ...goodReceipt, readerVersion: 'legacy' } }, 'req-1', startedAt, deadlineAt), false, 'legacy chart reader was accepted');
eq(api._chartReceiptComplete({ requestId: 'req-1', text: 'four', receipt: { ...goodReceipt, capturedAt: startedAt - 6000 } }, 'req-1', startedAt, deadlineAt), false, 'stale chart receipt was accepted');

ok(source.includes('Select all') && source.includes('Clear all') && source.includes('mlsOccPull') && source.includes('selected into MLS'), 'explicit selection/import controls are missing');
ok(source.includes('mlsOccCount') && source.includes("confirm.checked = false") && source.includes("' selected into MLS'"), 'selection count or consent reset is missing');
ok(source.includes('occurrenceEvidence') && source.includes('maskedClaim'), 'all retained occurrence evidence is not rendered locally');
ok(source.includes('Retry failed only') && source.includes('Needs identity review') && source.includes('Already present'), 'ephemeral per-patient receipts are incomplete');
const connectSource = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
ok(source.includes("type: 'mlsAppSearchProcedure'") && source.includes('window.__mlsVerifiedCandidateImport'), 'occurrence must use read-only report search and delegate selected chart pulls');
ok(connectSource.includes('window._assistReadChart(target') && connectSource.includes('window._parsePatientChart(chartText)') && connectSource.includes('window._savePatientChart(saveRef'), 'canonical shared importer must own exact chart read, parse, and sealed save');
ok(source.includes("procedureName: ''"), 'exact CPT search can still fill a competing procedure keyword control');
ok(!/mlsApp(?:Paste|Push|Sign|VerifiedWrite|AthenaAction)/.test(source), 'occurrence module gained an Athena write bridge');
ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|aiCall|api\/copilot|localStorage|sessionStorage|console\./.test(source), 'report evidence can leave ephemeral local memory');
ok(!source.includes('CLM-E') && !source.includes('Echo Example'), 'synthetic test evidence leaked into the implementation');

const boundaryRun = api._makeRun('import', {});
ok(boundaryRun && api._currentRun(boundaryRun), 'boundary test could not acquire a lease');
api._sessionBoundary();
ok(boundaryRun.cancelled && api._currentRun(boundaryRun), 'session boundary must cancel UI while retaining an uncorrelated draining request');
api._finishRun(boundaryRun);
ok(source.includes("window.addEventListener('mls:session-boundary'") && source.includes('snapshot = null'), 'session boundary does not clear ephemeral PHI');
ok(source.includes('function overlaySweep') && source.includes("document.getElementById('mlsStudyOv')"), 'Study overlay close does not clear the occurrence snapshot');

/* ---- Executed authenticated loader ownership / hot-refresh races ---- */
function loaderOwnershipMatrix() {
  const begin = connectSource.indexOf('/* 1p-only exact Athena occurrence search. Frozen extension/main site untouched. */');
  const end = connectSource.indexOf('/* A hot bundle refresh is allowed', begin);
  ok(begin >= 0 && end > begin, 'occurrence loader block could not be isolated');
  const loaderSource = connectSource.slice(begin, end);
  function harness(preview, fixedEntropy) {
    const children = [], docListeners = {};
    function node() { return { attrs: {}, parentNode: null, onload: null, onerror: null, setAttribute(k,v){this.attrs[k]=String(v);}, getAttribute(k){return this.attrs[k] == null ? null : this.attrs[k];}, removeAttribute(k){delete this.attrs[k];} }; }
    const head = { appendChild(n){n.parentNode=this;children.push(n);return n;}, removeChild(n){const i=children.indexOf(n);if(i>=0)children.splice(i,1);n.parentNode=null;} };
    const document = { readyState:'loading', currentScript:null, head, documentElement:head, body:null,
      createElement(){return node();}, getElementById(){return null;},
      querySelectorAll(sel){const m=sel.match(/data-mls-asset="([^"]+)"/);return m?children.filter(n=>n.getAttribute('data-mls-asset')===m[1]):[];},
      addEventListener(t,f){docListeners[t]=f;}, removeEventListener(){} };
    const listeners = {};
    const window = { __MLS_P1_PREVIEW: preview ? {enabled:true}:undefined, addEventListener(t,f){(listeners[t] ||= []).push(f);}, removeEventListener(t,f){listeners[t]=(listeners[t]||[]).filter(x=>x!==f);}, postMessage(){}, location:{origin:'https://mlsscribe.com'} };
    const sandbox = {window,document,MutationObserver:class{observe(){}disconnect(){}},Promise,Date:fixedEntropy?{now:()=>12345}:Date,Math:fixedEntropy?{random:()=>0.5}:Math,Object,String,Number,Array,RegExp,setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){}};
    vm.createContext(sandbox);
    return {window,document,children,sandbox,evalLoader(){vm.runInContext(loaderSource,sandbox);},evalAsset(n){document.currentScript=n;vm.runInContext(source,sandbox);document.currentScript=null;}};
  }
  let h=harness(false);h.evalLoader();eq(h.children.length,0,'occurrence loader ran outside the exact 1p preview marker');eq(h.window.__mlsP1AthenaOccurrenceLoader,undefined,'non-preview page acquired an occurrence controller');
  h=harness(true);h.evalLoader();let ctl=h.window.__mlsP1AthenaOccurrenceLoader,node=h.children[0];ok(ctl&&node,'preview loader did not create its owned script');eq(node.getAttribute('data-mls-asset'),'feat_mls_athena_occurrence.js','loader used the wrong canonical asset identity');eq(node.getAttribute('data-mls-install-token'),ctl.installToken,'loader did not bind the script to its install token');
  h.evalAsset(node);ok(h.window.__mlsAthenaOccurrence&&h.window.__mlsAthenaOccurrence.installToken===ctl.installToken,'authenticated asset did not publish its exact controller token');node.onload();eq(ctl.state,'ready','loader did not recognize its authenticated owner');const nodeCount=h.children.length;h.evalLoader();eq(h.children.length,nodeCount,'same ready controller duplicated its script');
  const oldCtl=ctl,oldApi=h.window.__mlsAthenaOccurrence;oldCtl.revert();h.evalLoader();const newCtl=h.window.__mlsP1AthenaOccurrenceLoader,newNode=h.children[0];h.evalAsset(newNode);newNode.onload();ok(newCtl!==oldCtl&&h.window.__mlsAthenaOccurrence!==oldApi,'hot refresh did not install a distinct owned controller/API');oldCtl.ensure();eq(oldCtl.revert(),false,'stale controller reverted a newer owner');oldApi.mount();oldApi._sessionBoundary();oldApi.revert();ok(h.window.__mlsP1AthenaOccurrenceLoader===newCtl&&h.window.__mlsAthenaOccurrence.installed===true,'stale saved refs mutated the newer occurrence owner');
  const direct=harness(true);const loose={getAttribute(){return null;}};direct.evalAsset(loose);eq(direct.window.__mlsAthenaOccurrence,undefined,'direct/unowned occurrence asset installed outside the loader');
  const late=harness(true);late.evalLoader();const lateCtl=late.window.__mlsP1AthenaOccurrenceLoader,lateNode=late.children[0];lateCtl.revert();late.evalAsset(lateNode);eq(late.window.__mlsAthenaOccurrence,undefined,'revert-before-late-eval orphan-installed the occurrence owner');eq(late.children.length,0,'reverted controller left its script attached');
  const stale=harness(true);let staleReverted=0;stale.window.__mlsAthenaOccurrence={installed:true,version:'p1-athena-occurrence-1.0.0',installToken:'old',revert(){staleReverted++;this.installed=false;}};stale.evalLoader();eq(staleReverted,1,'loader did not retire a reversible stale same-version owner');ok(stale.children.length===1&&stale.window.__mlsP1AthenaOccurrenceLoader.state==='loading','loader failed to recover after stale owner retirement');
  const collide=harness(true,true);collide.evalLoader();const c1=collide.window.__mlsP1AthenaOccurrenceLoader,t1=c1.installToken;c1.revert();collide.evalLoader();const c2=collide.window.__mlsP1AthenaOccurrenceLoader;ok(t1!==c2.installToken,'clock/RNG collision reused an occurrence install token');eq(c1.ensure(),false,'stale colliding controller reopened after replacement');eq(c1.revert(),false,'stale colliding controller tore down replacement');
  const corrupt=harness(true);let corruptReverted=0;const bad={installed:true,version:'p1-athena-occurrence-1.0.0',installToken:'bad',ensure:null,revert(){corruptReverted++;delete corrupt.window.__mlsP1AthenaOccurrenceLoader;}};corrupt.window.__mlsP1AthenaOccurrenceLoader=bad;corrupt.evalLoader();eq(corruptReverted,1,'reversible corrupt controller was not retired');ok(corrupt.window.__mlsP1AthenaOccurrenceLoader!==bad&&corrupt.children.length===1,'loader did not recover from a reversible corrupt controller');
  const noop=harness(true);let noopReverted=0;const noopCtl={installed:true,version:'p1-athena-occurrence-1.0.0',installToken:'noop',state:undefined,ensure(){return true;},revert(){noopReverted++;delete noop.window.__mlsP1AthenaOccurrenceLoader;return true;}};noop.window.__mlsP1AthenaOccurrenceLoader=noopCtl;noop.evalLoader();eq(noopReverted,1,'corrupt-state/no-op ensure controller suppressed recovery');ok(noop.window.__mlsP1AthenaOccurrenceLoader!==noopCtl&&noop.children.length===1,'real loader did not take over after corrupt-state/no-op ensure');
  const falseEnsure=harness(true);let falseReverted=0;const falseCtl={installed:true,version:'p1-athena-occurrence-1.0.0',installToken:'false',state:'idle',ensure(){return false;},revert(){falseReverted++;delete falseEnsure.window.__mlsP1AthenaOccurrenceLoader;return true;}};falseEnsure.window.__mlsP1AthenaOccurrenceLoader=falseCtl;falseEnsure.evalLoader();eq(falseReverted,1,'same-version false ensure suppressed loader recovery');ok(falseEnsure.window.__mlsP1AthenaOccurrenceLoader!==falseCtl&&falseEnsure.children.length===1,'false-ensure controller was not replaced');
  const blocked=harness(true);const unowned={installed:true,version:'p1-athena-occurrence-1.0.0',installToken:'bad',ensure(){}};blocked.window.__mlsP1AthenaOccurrenceLoader=unowned;blocked.evalLoader();eq(blocked.window.__mlsP1AthenaOccurrenceLoader,unowned,'unrevertible corrupt controller was unsafely replaced');eq(blocked.children.length,0,'unrevertible corrupt controller spawned competing script');
  const half=harness(true);half.evalLoader();const halfCtl=half.window.__mlsP1AthenaOccurrenceLoader,halfNode=half.children[0];half.window.__mlsAthenaOccurrence={installed:true,version:'p1-athena-occurrence-1.0.0',installToken:halfCtl.installToken,revert(){this.installed=false;}};halfNode.onload();ok(halfCtl.state==='owner-missing'||halfCtl.state==='loading','malformed exact-token API was marked ready');eq(half.window.__mlsAthenaOccurrence.installed,false,'malformed exact-token API was not retired before bounded recovery');
}

function sliceBetween(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'missing executable slice: ' + start); return text.slice(a, b);
}

/* The two preview shells carry the same canonical chart reader. Exercise the
   auto-claim/release behavior from each real shell source, including the exact
   synchronous ready() throw that formerly stranded the lease. */
async function shellLeaseMatrix() {
  for (const rel of ['1p/index.html', '1pScribeFlow.html']) {
    const html = fs.readFileSync(path.join(root, rel), 'utf8');
    const helper = sliceBetween(html, 'function _athenaHistoryDigits(v)', '/* Like _assistReadAthenaTab');
    const assist = sliceBetween(html, 'function _assistReadChart(patientRef, onStatus)', '/* The appointment BRIEFING');
    const handlers = [], posted = [];
    let active = '', releases = 0, readyThrows = false, seq = 0;
    const manager = { claim(){if(active)return null;active='lease-'+(++seq);return active;}, owns(t){return active===t;}, ready(t){if(readyThrows)throw new Error('synthetic-ready-throw');return active===t;}, touch(){return true;}, release(t){if(active!==t)return false;active='';releases++;return true;} };
    const patients = [{id:'p1',name:'Exact Person',dob:'01/02/1980',mrn:'A100'}];
    const c = { Promise,Date,Math,Object,String,Number,Array,RegExp,setTimeout,clearTimeout,setInterval,clearInterval,
      getPatients(){return patients;}, upsertPatient(){}, __mlsP1AthenaReadLease:manager,
      addEventListener(t,f){if(t==='message')handlers.push(f);}, removeEventListener(t,f){const i=handlers.indexOf(f);if(i>=0)handlers.splice(i,1);}, postMessage(m){posted.push(m);}, location:{origin:'https://mlsscribe.com'} };
    c.window=c; vm.runInNewContext(helper+'\n'+assist,c,{filename:rel+'-assist.js'});
    await assert.rejects(c._assistReadChart({name:'Missing'},()=>{}),/verified DOB or MRN/);eq(active,'',rel+' invalid target stranded its auto-claimed lease');
    readyThrows=true;await assert.rejects(c._assistReadChart({patientId:'p1',name:'Exact Person',dob:'01/02/1980',mrn:'A100'},()=>{}),/reader lock could not be acquired/);eq(active,'',rel+' synchronous ready throw stranded its lease');readyThrows=false;
    const pending=c._assistReadChart({patientId:'p1',name:'Exact Person',dob:'01/02/1980',mrn:'A100'},()=>{});await Promise.resolve();await Promise.resolve();
    eq(manager.claim('p1-occurrence-report'),null,rel+' allowed occurrence to overlap a legacy chart read');
    handlers.slice().forEach(f=>f({data:{source:'mls-ext',type:'mlsPong'}}));const req=posted.filter(x=>x.type==='mlsAppReadChart').pop();ok(req&&req.patientId==='p1',rel+' did not dispatch the exact owned chart read');
    const text='verified';const receipt={kind:'athena-chart-coverage',requestId:req.requestId,complete:true,readerVersion:'2.9.19-chart-r3',capturedAt:Date.now(),expectedClinicalFrames:1,readClinicalFrames:1,boundClinicalFrames:1,unboundClinicalFrames:0,oversizeClinicalFrames:0,unreadFrames:0,omittedForCap:0,consideredFrames:1,textChars:text.length,truncated:false,identityObserved:true,identityVia:'banner'};
    handlers.slice().forEach(f=>f({data:{source:'mls-ext',type:'mlsAppChartResult',requestId:req.requestId,deadlineAt:req.deadlineAt,resp:{ok:true,requestId:req.requestId,text,chartName:'Exact Person',chartDob:'01/02/1980',chartMrn:'A100',receipt}}}));await pending;eq(active,'',rel+' terminal chart read did not release its lease');
    const outer=manager.claim('p1-occurrence-patient-pull');ok(outer,rel+' could not acquire outer occurrence lease');await assert.rejects(c._assistReadChart({patientId:'p1',name:'Exact Person',dob:'01/02/1980',mrn:'A100'},()=>{}),/pull-in-flight/,rel+' unrelated legacy read overlapped occurrence');manager.release(outer);
    ok(releases>=4,rel+' did not exercise every terminal lease release');
  }
}

async function canonicalMutationMatrix() {
  const html=fs.readFileSync(path.join(root,'1p/index.html'),'utf8');
  const helpers=sliceBetween(html,'function _athenaHistoryDigits(v)','/* Like _assistReadAthenaTab');
  const save=sliceBetween(html,'function _athenaChartHistoryObject(chart)','/* Bulk: after pulling the schedule');
  let patients=[],notes=[],upserts=0;
  const c={Promise,Date,Math,Object,String,Number,Array,RegExp,console,getPatients(){return JSON.parse(JSON.stringify(patients));},upsertPatient(p){upserts++;const i=patients.findIndex(x=>x.id===p.id);if(i>=0)patients[i]=JSON.parse(JSON.stringify(p));else patients.push(JSON.parse(JSON.stringify(p)));},getNotes(){return JSON.parse(JSON.stringify(notes));},saveNotes(n){notes=JSON.parse(JSON.stringify(n));},renderProfile(){},renderPatientBar(){},renderPatients(){},renderHistory(){},loadPatients(){},getActivePtId(){return '';}};c.window=c;vm.runInNewContext(helpers+'\n'+save,c,{filename:'p1-canonical-save.js'});
  const observed={requestId:'r1',chartName:'Atomic Person',chartDob:'01/02/1980',chartMrn:'ATH100'};
  const ref1=c._athenaNewPatientVerifiedRef({name:'Atomic Person',dob:'01/02/1980',athenaId:'ATH100',requestId:'r1'},observed);const ref2=c._athenaNewPatientVerifiedRef({name:'Atomic Person',dob:'01/02/1980',athenaId:'ATH100',requestId:'r1'},observed);ok(ref1&&ref2,'canonical new-patient refs did not seal before persistence');eq(upserts,0,'identity sealing persisted a patient before chart coverage');
  const incomplete={problems:'',meds:'',allergies:'',summary:'',vitals:{},history:{},visits:[],coverage:{problems:'not_documented'}};eq(c._savePatientChart(ref1,null,incomplete),false,'incomplete six-card chart persisted');eq(upserts,0,'refused coverage caused a pre-upsert mutation');
  const complete={problems:'',meds:'',allergies:'',summary:'',vitals:{},history:{},visits:[],coverage:{problems:'not_documented',meds:'not_documented',allergies:'not_documented',summary:'not_documented',vitals:'not_documented',history:'not_documented'}};
  eq(c._savePatientChart(ref1,null,complete),true,'verified covered candidate did not persist');eq(upserts,1,'verified candidate did not persist exactly once');eq(c._savePatientChart(ref2,null,complete),false,'pre-sealed duplicate candidate created a second patient');eq(upserts,1,'duplicate collision performed a second upsert');eq(patients.length,1,'atomic candidate save left duplicate patients');

  const section=sliceBetween(connectSource,'function candidateNameKey(v)','function importRow(row, cohort)');let tags=0,reads=0;
  const ci={Promise,Date,Math,Object,String,Number,Array,RegExp,setInterval,clearInterval,getPatients(){return [{id:'p1',name:'Existing Person',dob:'01/02/1980',athenaId:'ATH100'}];},normDob(v){return String(v||'').replace(/\D/g,'');},tagPatientCohort(){tags++;},buildApptForRow(){return{};},_assistReadChart(){reads++;return Promise.resolve({});}};ci.window=ci;vm.runInNewContext(section+'\nwindow.__testImporter=verifiedCandidateImport;',ci,{filename:'p1-candidate-import.js'});
  const cancelled=await ci.__testImporter({name:'Existing Person',dob:'01/02/1980',patientId:'ATH100'},'cohort',{isCurrent(){return false;}});eq(cancelled.code,'failed','stale importer did not fail closed');eq(tags,0,'stale existing-patient importer mutated cohort tags');eq(reads,0,'stale existing-patient importer started an Athena chart read');

  let active='candidate-token',released=0,heartbeats=new Set();
  const throwCtx={Promise,Date,Math,Object,String,Number,Array,RegExp,setInterval(fn){const id={fn};heartbeats.add(id);return id;},clearInterval(id){heartbeats.delete(id);},getPatients(){return[];},normDob:ci.normDob,tagPatientCohort(){},buildApptForRow(){return{};},_assistReadChart(){reads++;return Promise.resolve({});},_athenaChartTextForParse(){},_parsePatientChart(){},_athenaChartProfileCoverage(){},_athenaNewPatientVerifiedRef(){},_savePatientChart(){},__mlsP1AthenaReadLease:{claim(){return active;},owns(){return false;},ready(){throw new Error('candidate-ready-throw');},touch(){},release(t){if(t===active){active='';released++;return true;}return false;}}};throwCtx.window=throwCtx;vm.runInNewContext(section+'\nwindow.__testImporter=verifiedCandidateImport;',throwCtx,{filename:'p1-candidate-ready.js'});
  const throwResult=await throwCtx.__testImporter({name:'New Person',dob:'01/02/1980',patientId:'ATH200'},'',{});eq(throwResult.code,'failed','candidate sync-ready throw did not settle failed');eq(released,1,'candidate sync-ready throw stranded its token');eq(active,'','candidate sync-ready throw left token active');eq(heartbeats.size,0,'candidate sync-ready throw leaked heartbeat');
}

function sharedStudyDateRangeMatrix() {
  const study=fs.readFileSync(path.join(root,'1p-mls-connect.js'),'utf8');
  const dateHelpers=sliceBetween(study,'function parseDateInput(v){','function classifyDates(arr){');
  const rangeFn=sliceBetween(study,'function inRange(svc, from, to){','function filterReportRows(rows, crit){');
  const c={Date,String,Number,Math,normDob(v){const m=String(v||'').match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);return m?('0'+m[1]).slice(-2)+('0'+m[2]).slice(-2)+m[3]:'';}};c.window=c;vm.runInNewContext(dateHelpers+'\n'+rangeFn,c,{filename:'p1-study-range.js'});
  eq(c.inRange('', '', ''),true,'unbounded Study query rejected missing service date');
  eq(c.inRange('', '2026-01-01', ''),false,'from-bounded Study query accepted missing service date');
  eq(c.inRange('not-a-date', '', '2026-12-31'),false,'to-bounded Study query accepted malformed service date');
  eq(c.inRange('12/31/2025','2026-01-01',''),false,'from-only bound accepted below-range occurrence');
  eq(c.inRange('01/01/2026','2026-01-01',''),true,'from-only bound rejected exact boundary');
  eq(c.inRange('01/02/2027','','2026-12-31'),false,'to-only bound accepted above-range occurrence');
  eq(c.inRange('12/31/2026','','2026-12-31'),true,'to-only bound rejected exact boundary');
  eq(c.inRange('06/15/2026','2026-01-01','2026-12-31'),true,'two-sided bound rejected inside-range occurrence');
  eq(c.inRange('12/31/2025','2026-01-01','2026-12-31'),false,'two-sided bound accepted below-range occurrence');
  eq(c.inRange('01/01/2027','2026-01-01','2026-12-31'),false,'two-sided bound accepted above-range occurrence');
}

async function sharedStudyReadyThrowMatrix() {
  const study=fs.readFileSync(path.join(root,'1p-mls-connect.js'),'utf8');
  const report=sliceBetween(study,'function assistReadReport(onStatus){','function readReportText(onStatus){');
  const search=sliceBetween(study,'function assistSearchProcedure(params, cfg, onStatus){','function doAutoSearchAthena(body){');
  for(const item of [{name:'report',source:report,fn:'assistReadReport',args:[()=>{}]},{name:'search',source:search,fn:'assistSearchProcedure',args:[{}, {}, ()=>{}]}]){
    const handlers=[],intervals=new Set();let releases=0,active='';
    const mgr={claim(){active=item.name+'-token';return active;},ready(){throw new Error('synthetic-ready-throw');},touch(){},release(t){if(t===active){active='';releases++;return true;}return false;}};
    const c={Promise,Date,Math,Object,String,Number,Array,RegExp,setTimeout(){return 1;},clearTimeout(){},setInterval(fn){const id={fn};intervals.add(id);return id;},clearInterval(id){intervals.delete(id);},safe(fn,fallback){try{return fn();}catch(e){return fallback;}},__mlsP1AthenaReadLease:mgr,location:{origin:'https://mlsscribe.com'},addEventListener(t,f){if(t==='message')handlers.push(f);},removeEventListener(t,f){if(t==='message'){const i=handlers.indexOf(f);if(i>=0)handlers.splice(i,1);}},postMessage(){}};c.window=c;vm.runInNewContext(item.source,c,{filename:'p1-study-'+item.name+'-ready.js'});
    await assert.rejects(c[item.fn].apply(null,item.args),/reader lock could not be acquired/);eq(releases,1,'Study '+item.name+' sync-ready throw did not release central token');eq(active,'','Study '+item.name+' sync-ready throw left token active');eq(handlers.length,0,'Study '+item.name+' sync-ready throw leaked pong/result listener');eq(intervals.size,0,'Study '+item.name+' sync-ready throw leaked heartbeat');
  }
}

async function managedScheduleLeaseMatrix() {
  const si=fs.readFileSync(path.join(root,'1p-feat_mls_schedimport_exact.js'),'utf8');
  const block=sliceBetween(si,'var SI_LEASE_ID =','function retryFailedHistory(source, onStatus)');
  for(const marker of ['-r2chart','chartRequestId','-trreopen','-reopen','-chart-d2'])ok(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[\\s\\S]{0,240}athenaOwnerToken: siAthenaOwnerToken').test(si),'managed schedule nested chart read omitted owner token at '+marker);
  let active='',releases=0,webRequests=0;const mgr={claim(){if(active)return null;active='si-owner';return active;},ready(t){return t===active;},touch(){return true;},release(t){if(t!==active)return false;active='';releases++;return true;}};
  const store=new Map(),c={Promise,Date,Math,Object,String,Number,Array,RegExp,isFinite,setTimeout,clearTimeout,setInterval(){return 1;},clearInterval(){},safe(fn,fallback){try{const v=fn();return v===undefined?fallback:v;}catch(e){return fallback;}},isFn(v){return typeof v==='function';},pullRunning:false,releaseManagedAthenaWorkspace(){},__mlsP1AthenaReadLease:mgr,__mlsSchedulePullLease:null,__mlsPullBusyAt:0,localStorage:{setItem(k,v){store.set(k,v);},removeItem(k){store.delete(k);}},navigator:{locks:{request(){webRequests++;throw new Error('nested Web Lock must not run');}}},uns(v){return v;}};c.window=c;vm.runInNewContext(block+'\nwindow.__testManaged=runManagedAthenaOperation;window.__testSiToken=function(){return siAthenaOwnerToken;};',c,{filename:'p1-si-managed.js'});
  for(const scope of ['default-monday','selected-provider']){let seen='';const result=await c.__testManaged(function(){seen=c.__testSiToken();eq(mgr.claim('p1-occurrence-report'),null,scope+' allowed occurrence overlap');return {ok:true,complete:true,scope};},()=>({ok:false,complete:false}));eq(result.scope,scope,scope+' managed pull did not settle');eq(seen,'si-owner',scope+' nested chart reads lacked the exact central owner');eq(active,'',scope+' left the central Athena lease active');}
  eq(webRequests,0,'managed SI path double-acquired the browser Web Lock');eq(releases,2,'managed SI path did not release once per terminal operation');
}

/* ---- Executed DOM/message/import flow (real selector/event behavior) ---- */
async function runtimeDomMatrix() {
  class FakeElement {
    constructor(id, rootPanel) { this.id = id || ''; this.rootPanel = rootPanel || this; this.style = {}; this.disabled = false; this.checked = false; this.value = ''; this.textContent = ''; this._html = ''; this._handlers = {}; this._attrs = {}; this.parentNode = null; }
    addEventListener(type, fn) { (this._handlers[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this._handlers[type] = (this._handlers[type] || []).filter(x => x !== fn); }
    dispatchEvent(e) { e = e || { type: '' }; e.target ||= this; for (const fn of (this._handlers[e.type] || []).slice()) fn.call(this, e); return true; }
    click() { if (!this.disabled) this.dispatchEvent({ type: 'click', target: this }); }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
    removeAttribute(k) { delete this._attrs[k]; }
    remove() { if (fakeDocument.panel === this) fakeDocument.panel = null; this.parentNode = null; }
    querySelector(sel) { return this.rootPanel._query(sel); }
    querySelectorAll(sel) { return this.rootPanel._queryAll(sel); }
    get innerHTML() { return this._html; }
    set innerHTML(html) { this._html = String(html); this.textContent = this._html.replace(/<[^>]*>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim(); if (this.id === 'mlsOccOut') this.rootPanel._parseOutput(this._html); }
  }
  class FakePanel extends FakeElement {
    constructor() { super('mlsOccPanel'); this.rootPanel = this; this.__mlsOccEpoch = 0; this._map = {}; this._checks = []; ['mlsOccQuery','mlsOccFacility','mlsOccOut','mlsOccSearch','mlsOccCancel','mlsOccResolved'].forEach(id => this._add(id)); }
    _add(id) { const el = new FakeElement(id, this); this._map[id] = el; return el; }
    _query(sel) { if (sel[0] === '#') return this._map[sel.slice(1)] || null; if (sel === '.mls-occ-check') return this._checks[0] || null; return null; }
    _queryAll(sel) { if (sel === '.mls-occ-check') return this._checks.slice(); if (sel === '.mls-occ-check:checked') return this._checks.filter(x => x.checked); return []; }
    _parseOutput(html) {
      for (const id of Object.keys(this._map)) if (/^mlsOcc(?:All|None|Confirm|Pull|Retry|Count|Batch|State\d+)$/.test(id)) delete this._map[id];
      this._checks = [];
      const count = (html.match(/class="mls-occ-check"/g) || []).length;
      if (!count) return;
      for (let i = 0; i < count; i++) { const c = new FakeElement('', this); c.className = 'mls-occ-check'; c.setAttribute('data-i', i); this._checks.push(c); this._add('mlsOccState' + i); }
      for (const id of ['mlsOccAll','mlsOccNone','mlsOccConfirm','mlsOccPull','mlsOccRetry','mlsOccCount','mlsOccBatch']) this._add(id);
      this._map.mlsOccPull.disabled = true; this._map.mlsOccRetry.style.display = 'none'; this._map.mlsOccCount.textContent = '0 of ' + count + ' selected';
    }
  }
  const messageListeners = [], windowListeners = {}, posts = [], timers = new Set();
  const installNode = { getAttribute(name) { return name === 'data-mls-install-token' ? 'runtime-token' : (name === 'data-mls-asset' ? 'feat_mls_athena_occurrence.js' : null); } };
  const fakeDocument = {
    readyState: 'loading', currentScript: installNode, panel: null, documentElement: {}, head: { appendChild() {} }, body: { appendChild() {} },
    getElementById(id) { if (id === 'mlsOccPanel') return this.panel; if (id === 'mlsStudyOv') return this.panel ? {} : null; return this.panel && this.panel._query('#' + id); },
    createElement(tag) { return new FakeElement('', this.panel || undefined); }, addEventListener() {}, removeEventListener() {}
  };
  const w = {
    __MLS_P1_PREVIEW: { enabled: true }, __mlsP1AthenaOccurrenceLoader: { installed: true, version: 'p1-athena-occurrence-1.0.0', installToken: 'runtime-token' },
    location: { origin: 'https://mlsscribe.com' },
    addEventListener(type, fn) { if (type === 'message') messageListeners.push(fn); else (windowListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { if (type === 'message') { const i = messageListeners.indexOf(fn); if (i >= 0) messageListeners.splice(i, 1); } else windowListeners[type] = (windowListeners[type] || []).filter(x => x !== fn); },
    postMessage(m) { posts.push(m); }
  };
  const sandbox = { window: w, document: fakeDocument, MutationObserver: class { observe() {} disconnect() {} }, Promise, Date, Math, Object, String, Number, Array, RegExp, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.runInNewContext(source, sandbox, { filename: 'occurrence-runtime.js' });
  const a = w.__mlsAthenaOccurrence;
  let panel = fakeDocument.panel = new FakePanel();
  panel._map.mlsOccSearch.addEventListener('click', () => a._runSearch(panel));
  panel._map.mlsOccCancel.addEventListener('click', () => a.cancel());
  panel._map.mlsOccQuery.addEventListener('input', () => a._updateResolution(panel));
  panel._map.mlsOccFacility.addEventListener('input', () => a._updateResolution(panel));
  ok(panel && a && a.installed, 'self-contained runtime harness did not install the authenticated occurrence owner');
  const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
  const message = data => { const e = { data, origin: w.location.origin, source: w }; for (const fn of messageListeners.slice()) fn(e); };
  const evt = type => ({ type });
  const spec = a._parseQuery('Who had CPT 62330 at SCCC?', 'SCCC');
  const candidates = a._dedupeForDisplay(a._filterRows(a._parseRows([
    'POSM ASC Chester County 07/03/2026 Alpha, Alice Patient ID: 1001 01/02/1980 Claim ID: XA Procedure Code 62330',
    'POSM ASC Chester County 07/04/2026 Bravo, Bailey Patient ID: 2002 02/03/1981 Claim ID: XB Procedure Code 62330'
  ].join('\n')), spec));
  const snap = { id: 1, epoch: 0, spec, candidates, receipt: { complete: false, partial: true, truncated: true, pages: 60, chars: 20, reason: 'truncated-or-page-limit' }, statuses: {} };
  a._renderResults(panel, snap);
  ok(panel.querySelector('#mlsOccOut').textContent.includes('Completeness not verified') && panel.querySelector('#mlsOccOut').textContent.includes('truncated-or-page-limit'), 'partial/truncated retrieval was not visibly incomplete');
  const checks = [...panel.querySelectorAll('.mls-occ-check')], all = panel.querySelector('#mlsOccAll'), none = panel.querySelector('#mlsOccNone'), confirm = panel.querySelector('#mlsOccConfirm'), pull = panel.querySelector('#mlsOccPull');
  eq(checks.length, 2, 'runtime result checkboxes did not render');
  eq(pull.disabled, true, 'zero-selected pull started enabled');
  all.click();
  ok(checks.every(c => c.checked), 'Select all did not select every patient');
  eq(panel.querySelector('#mlsOccCount').textContent, '2 of 2 selected', 'Select all count is wrong');
  confirm.checked = true; confirm.dispatchEvent(evt('change'));
  eq(pull.disabled, false, 'explicit confirmation did not enable selected pull');
  checks[0].checked = false; checks[0].dispatchEvent(evt('change'));
  eq(confirm.checked, false, 'partial selection did not reset confirmation');
  eq(panel.querySelector('#mlsOccCount').textContent, '1 of 2 selected', 'partial selection count is wrong');
  none.click();
  ok(checks.every(c => !c.checked) && pull.disabled, 'Clear all did not return to a safe zero selection');
  pull.click();
  eq((panel.querySelector('#mlsOccBatch') || {}).textContent || '', '', 'disabled zero-selected pull executed');

  all.click(); confirm.checked = true; confirm.dispatchEvent(evt('change'));
  const imported = [];
  w.__mlsVerifiedCandidateImport = async row => { imported.push(row.patientId); return row.patientId === '1001' ? { code: 'failed', reason: 'synthetic read failure' } : { code: 'imported' }; };
  const firstBatch = a._runImport(panel, snap, [0, 1], false);
  const firstDone = await firstBatch;
  eq(imported.join(','), '1001,2002', 'one patient failure stopped the sequential batch');
  eq(firstDone.verdict.counts.failed, 1, 'failed patient was lost from the batch receipt');
  eq(firstDone.verdict.counts.imported, 1, 'successful patient after a failure was not counted');
  const retry = panel.querySelector('#mlsOccRetry');
  ok(retry && retry.style.display !== 'none', 'Retry failed only did not appear');
  imported.length = 0; w.__mlsVerifiedCandidateImport = async row => { imported.push(row.patientId); return { code: 'imported' }; };
  retry.click(); await tick(140);
  eq(imported.join(','), '1001', 'Retry failed only queued a nonfailed patient');

  /* A real Search click may post only after the shared cross-tab lock resolves.
     A result before our pong/dispatch is ignored, and both control proofs gate it. */
  a._studyLifecycle();
  panel = fakeDocument.panel = new FakePanel(); panel.__mlsOccEpoch = a._debugState().epoch;
  panel._map.mlsOccSearch.addEventListener('click', () => a._runSearch(panel)); panel._map.mlsOccCancel.addEventListener('click', () => a.cancel()); panel._map.mlsOccQuery.addEventListener('input', () => a._updateResolution(panel)); panel._map.mlsOccFacility.addEventListener('input', () => a._updateResolution(panel));
  const qi = panel.querySelector('#mlsOccQuery'), fi = panel.querySelector('#mlsOccFacility');
  qi.value = 'Who had CPT 62330 at SCCC?'; fi.value = 'SCCC'; posts.length = 0;
  /* Cancel before pong is a true pre-dispatch abort: no report work starts and
     the shared owner is released immediately. */
  panel.querySelector('#mlsOccSearch').click(); await tick();
  panel.querySelector('#mlsOccCancel').click(); await tick();
  message({ source: 'mls-ext', type: 'mlsPong' }); await tick();
  eq(posts.filter(x => x.type === 'mlsAppSearchProcedure').length, 0, 'pre-dispatch cancel still started Athena report work');
  eq(a._debugState().lease, null, 'pre-dispatch cancel retained the Athena owner');

  /* Once the uncorrelated frozen bridge has dispatched, Cancel hides/rejects
     the result but deliberately retains the listener/lease until that one old
     terminal response drains. */
  panel.querySelector('#mlsOccSearch').click(); await tick(); message({ source: 'mls-ext', type: 'mlsPong' }); await tick();
  eq(posts.filter(x => x.type === 'mlsAppSearchProcedure').length, 1, 'post-dispatch cancel setup did not start exactly one report');
  panel.querySelector('#mlsOccCancel').click(); await tick();
  ok(a._debugState().lease && a._debugState().lease.cancelled, 'post-dispatch cancel released the uncorrelated bridge before drain');
  panel.querySelector('#mlsOccSearch').click(); await tick();
  eq(posts.filter(x => x.type === 'mlsAppSearchProcedure').length, 1, 'a second report overlapped the canceled draining report');
  message({ source: 'mls-ext', type: 'mlsAppSearchResult', resp: { ok: true, text: 'DISCARDED', ranControls: { filledCpt: true, clickedRun: true } } }); await tick();
  eq(a._debugState().lease, null, 'terminal canceled response did not drain/release the owner');
  eq(a._snapshot(), null, 'post-dispatch canceled response painted stale results');

  posts.length = 0;
  panel.querySelector('#mlsOccSearch').click(); await tick();
  eq(posts.filter(x => x.type === 'mlsAppSearchProcedure').length, 0, 'search posted before its ping/pong phase');
  message({ source: 'mls-ext', type: 'mlsAppSearchResult', resp: { ok: true, text: 'OLD RESULT', ranControls: { filledCpt: true, clickedRun: true } } });
  await tick(); eq(a._snapshot(), null, 'pre-dispatch old result painted as the new query');
  message({ source: 'mls-ext', type: 'mlsPong' }); await tick();
  eq(posts.filter(x => x.type === 'mlsAppSearchProcedure').length, 1, 'owned search was not posted after pong');
  message({ source: 'mls-ext', type: 'mlsAppSearchResult', resp: { ok: true, text: 'POSM ASC Chester County 07/03/2026 Charlie, Casey Patient ID: 3003 03/04/1982 Claim ID: XC Procedure Code 62330', pages: 1, ranControls: { filledCpt: true, clickedRun: false } } });
  await tick(); ok(panel.querySelector('#mlsOccOut').textContent.includes('did not prove'), 'Run-without-click proof was accepted');

  /* Re-run and prove the successful report sentinel is only parsed/rendered;
     it never reaches the selected chart importer until a checkbox+confirm. */
  qi.value = 'Who had CPT 62330 at SCCC?'; fi.value = 'SCCC'; panel.querySelector('#mlsOccSearch').click(); await tick(); message({ source: 'mls-ext', type: 'mlsPong' }); await tick();
  const reportSentinel = 'REPORT_ONLY_SENTINEL'; let importerSawSentinel = false, importerCalls = 0;
  w.__mlsVerifiedCandidateImport = async row => { importerCalls++; if (JSON.stringify(row).includes(reportSentinel)) importerSawSentinel = true; return { code: 'already' }; };
  message({ source: 'mls-ext', type: 'mlsAppSearchResult', resp: { ok: true, text: 'POSM ASC Chester County 07/05/2026 Delta, Drew Patient ID: 4004 04/05/1983 Claim ID: XD Procedure Code 62330 ' + reportSentinel, pages: 1, ranControls: { filledCpt: true, clickedRun: true } } });
  await tick(); eq(importerCalls, 0, 'report search imported before explicit selection/confirmation');
  const resultCheck = panel.querySelector('.mls-occ-check'); resultCheck.checked = true; resultCheck.dispatchEvent(evt('change'));
  panel.querySelector('#mlsOccConfirm').checked = true; panel.querySelector('#mlsOccConfirm').dispatchEvent(evt('change')); panel.querySelector('#mlsOccPull').click(); await tick(140);
  eq(importerCalls, 1, 'confirmed selected result did not delegate once');
  eq(importerSawSentinel, false, 'raw report evidence crossed into the canonical chart importer');

  /* Re-running the identical question invalidates the prior named snapshot at
     the moment the replacement search is accepted, even if it is then canceled. */
  panel.querySelector('#mlsOccSearch').click(); await tick();
  eq(a._snapshot(), null, 'accepted replacement search retained prior named PHI in memory');
  panel.querySelector('#mlsOccCancel').click(); await tick();
  eq(a._snapshot(), null, 'canceled replacement search resurrected the prior named snapshot');

  /* Editing the query invalidates names + consent; session/overlay lifecycle
     synchronously clears them and rejects late repaint. */
  qi.value = 'Who had CPT 11111 at SCCC?'; qi.dispatchEvent(evt('input'));
  eq(a._snapshot(), null, 'query edit retained stale result snapshot');
  ok(!panel.querySelector('.mls-occ-check'), 'query edit retained stale named rows');
  const lifeRun = a._makeRun('search', panel); a._setSnapshot(snap); a._sessionBoundary();
  ok(lifeRun.cancelled && a._currentRun(lifeRun) && !a._debugState().hasSnapshot, 'session boundary failed to clear PHI while retaining the draining owner');
  a._finishRun(lifeRun);

  a.revert(); await tick(20);
  eq(messageListeners.length, 0, 'runtime flow leaked an Athena message listener after terminal cleanup');
}

loaderOwnershipMatrix();
Promise.resolve().then(shellLeaseMatrix).then(canonicalMutationMatrix).then(sharedStudyDateRangeMatrix).then(sharedStudyReadyThrowMatrix).then(managedScheduleLeaseMatrix).then(runtimeDomMatrix).then(() => {
  console.log('PASS 1p Athena occurrence search: ' + passed + ' assertions');
}).catch(err => { console.error(err && err.stack || err); process.exitCode = 1; });
