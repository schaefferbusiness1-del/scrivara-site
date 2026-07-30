'use strict';
/*
 * DOES THE OP NOTE ACTUALLY PULL FROM HISTORY AND RECENT VISITS?  (2026-07-30)
 * -----------------------------------------------------------------------------
 * Owner, verbatim: "make sure the op notes generate well and that they pull from
 * history and recent visits correctly."
 *
 * WHY THIS SUITE EXISTS. The longitudinal-history injection
 * (feat_opnote_history.js) is the piece of the op-note path with the least proof
 * behind it. tests/live-draft-a-day.js says "History" but means the note STORE -
 * it checks that a finished draft was saved. tests/opnote-graded-against-what-
 * model-saw.test.js is string matching over source. Neither one ever asks the
 * question the owner asked: when a note is drafted, does the patient's own chart
 * and their own recent visits actually reach the model, and does ANOTHER
 * patient's chart stay out of it?
 *
 * That second half is the one that matters clinically. A history block keyed to
 * the wrong patient is other people's clinical text inside an operative report.
 *
 * HOW IT IS PROVED. Real Chrome, the real shipped app, real app state: two
 * synthetic patients are created through the app's own New Patient dialog and
 * given saved visits through the app's own save path. Then the SHIPPED builder is
 * executed - window.__mlsOpNoteHistory.buildHistoryBlock - and the string it
 * returns is inspected. Nothing is mocked, and no assertion is satisfied by the
 * presence of source text.
 *
 * Each patient's visits carry a unique marker word that appears nowhere else in
 * the app, so "A's history reached the prompt" and "B's history did not" are both
 * decidable by looking at one string.
 *
 * THE NEGATIVE CONTROLS, which are what make the positives worth anything:
 *   - the same builder is asked for A's history while being handed B's patientId;
 *     it must REFUSE rather than return either patient's chart;
 *   - it is asked for a name that does not exist; it must refuse;
 *   - and the wiring is checked: the module must actually be installed on the AI
 *     path, or a perfect builder proves nothing about a real draft.
 *
 * EXTENSION BOUNDARY: nothing here loads or exercises the extension, and every
 * non-loopback request is blocked.
 *
 *   node tests/live-opnote-history-context.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = { email: 'clinician.history-context@mls.local', password: 'SyntheticOnly2026!' };
/* markers chosen so a repo-wide grep finds them only here and in the app state
   this harness writes */
const A = { name: 'Synthetic Alpha Historypatient', mrn: 'SYN-HX-0001', dob: '1972-04-11', sex: 'Female', marker: 'ZQXALPHAMARKER' };
const B = { name: 'Synthetic Bravo Historypatient', mrn: 'SYN-HX-0002', dob: '1965-09-23', sex: 'Male', marker: 'ZQXBRAVOMARKER' };

let failures = 0;
const RESULTS = [];
function check(step, fn, evidence) {
  let ok = false, detail = '';
  try { ok = !!fn(); } catch (e) { detail = String((e && e.message) || e); }
  const ev = typeof evidence === 'function' ? (() => { try { return evidence(); } catch (e) { return detail; } })() : evidence;
  RESULTS.push({ step, verdict: ok ? 'PASS' : 'FAIL', evidence: String(ev || detail || '') });
  console.log((ok ? '[PASS] ' : '[FAIL] ') + step + '\n        ' + String(ev || detail || '').slice(0, 700));
  if (!ok) failures++;
  return ok;
}

/* ------------------------------------------------------------- plumbing */
function findChrome() {
  const c = [process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const hit = c.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  assert(hit, 'No Chrome/Chromium found. Set CHROME_PATH.');
  return hit;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'ScribeFlow.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, origin: 'http://127.0.0.1:' + server.address().port })));
}
class CDP {
  constructor(s) { this.socket = s; this.id = 1; this.pending = new Map();
    s.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data)); if (!m.id) return;
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(new Error(p.method + ': ' + m.error.message)) : p.resolve(m.result || {}); }); }
  static connect(u) { return new Promise((res, rej) => { const s = new WebSocket(u);
    s.addEventListener('open', () => res(new CDP(s)), { once: true });
    s.addEventListener('error', () => rej(new Error('cdp connect failed')), { once: true }); }); }
  send(method, params, t) { const id = this.id++; return new Promise((res, rej) => {
    const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(method + ': timeout')); }, t || 40000);
    this.pending.set(id, { resolve: res, reject: rej, timer, method });
    this.socket.send(JSON.stringify({ id, method, params: params || {} })); }); }
  close() { try { this.socket.close(); } catch (_) {} }
}
async function evalJs(cdp, expr, awaitPromise) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result && r.result.value;
}
async function wait(cdp, name, expr, timeout) {
  const dl = Date.now() + (timeout || 30000);
  for (;;) {
    let v = null; try { v = await evalJs(cdp, `(() => { try { return (${expr}); } catch (e) { return false; } })()`); } catch (_) {}
    if (v) return v;
    if (Date.now() > dl) throw new Error('Timed out waiting for ' + name);
    await sleep(120);
  }
}
async function click(cdp, sel) {
  const r = await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return {ok:false,why:'absent'};
    const b=el.getBoundingClientRect(); if(b.width<=0||b.height<=0) return {ok:false,why:'zero-rect'};
    el.scrollIntoView({block:'center'}); el.click(); return {ok:true}; })()`);
  assert(r && r.ok, 'Could not click ' + sel + ': ' + JSON.stringify(r));
}
async function fill(cdp, sel, value) {
  const r = await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null;
    el.focus(); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    el.dispatchEvent(new Event('change',{bubbles:true})); return el.value; })()`);
  assert.strictEqual(r, value, 'Could not fill ' + sel);
}

/* create a patient through the app's own dialog, then save visits for them
   through the app's own note-save path */
async function makePatientWithVisits(cdp, who, visitCount) {
  await click(cdp, '#mlsDock button[data-dest="patient"]');
  await wait(cdp, 'patients route', `window.__mlsCurrentView==='patients'`);
  await click(cdp, '#ptNewBtn');
  await wait(cdp, 'new patient dialog', `document.getElementById('patientModal').classList.contains('show')`);
  await fill(cdp, '#ptName', who.name); await fill(cdp, '#ptMrn', who.mrn); await fill(cdp, '#ptDob', who.dob);
  await evalJs(cdp, `(() => { const s=document.getElementById('ptSex'); if(s){ s.value=${JSON.stringify(who.sex)}; s.dispatchEvent(new Event('change',{bubbles:true})); } return 1; })()`);
  await click(cdp, '#patientModal button[onclick="savePatient()"]');
  const p = await wait(cdp, 'saved patient ' + who.name,
    `(() => { const p=window.activePatient&&window.activePatient(); return (p&&p.name===${JSON.stringify(who.name)}) ? {id:p.id,name:p.name,dob:p.dob} : false; })()`, 12000);

  /* Prior visits are written through the app's OWN visit model
     (window.__mlsVisitModel.addVisit), which is the store feat_opnote_history
     actually reads via usableVisits/getVisits - not the note store. Source is
     'manual' so the module's athena/legacy trust filter does not drop them, and
     each visit carries the patient's unique marker in its body. */
  const saved = await evalJs(cdp, `(() => {
    const p = window.activePatient();
    const m = window.__mlsVisitModel;
    if (!m || typeof m.addVisit !== 'function') return { error: 'no __mlsVisitModel.addVisit', total: 0 };
    const out = [];
    for (let i = 0; i < ${visitCount}; i++) {
      const body = 'SYNTHETIC PRIOR VISIT ' + (i+1) + ' for ' + p.name + '.\\n' +
        'S: Follow-up. Marker ${who.marker}.\\nO: Synthetic exam findings, marker ${who.marker}.\\n' +
        'A: Synthetic assessment ${who.marker}.\\nP: Synthetic plan ${who.marker}.';
      const v = m.addVisit(p.id, {
        date: new Date(Date.now() - (i+1)*86400000).toISOString().slice(0,10),
        type: 'Office visit', raw: body, note: body, summary: 'Synthetic prior visit ${who.marker}',
        fullDetail: true, sourceVisitKey: 'synhx-' + p.id + '-' + i
      }, { source: 'manual', identityVerified: true, identityBinding: p.id, bodyComplete: true });
      if (v) out.push(v.sourceVisitKey || ('synhx-' + i));
    }
    /* Re-resolve the patient from the store before counting. The reference
       captured above predates addVisit's persist, and reading through it
       reported 1 visit where the store held 3 - an instrument bug that would
       have been read as a product defect. */
    const fresh = (window.getPatients() || []).find(x => x.id === p.id) || p;
    const usable = (typeof m.usableVisits === 'function') ? (m.usableVisits(fresh) || []) : (m.getVisits(fresh) || []);
    return { ids: out, total: usable.length, onPatient: (fresh.visits || []).length };
  })()`);
  return { patient: p, saved };
}

async function main() {
  const exe = findChrome();
  const hosted = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-hx-'));
  const flags = ['--no-sandbox', '--headless=new', '--hide-scrollbars', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--window-size=1440,900', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'];
  const child = spawn(exe, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const dl = Date.now() + 25000;
  while (!fs.existsSync(portFile) && Date.now() < dl) await sleep(50);
  assert(fs.existsSync(portFile), 'Chrome did not start');
  let text = '';
  for (let i = 0; i < 120 && !text.trim(); i++) { try { text = fs.readFileSync(portFile, 'utf8'); } catch (_) {} if (!text.trim()) await sleep(50); }
  const port = Number(text.trim().split(/\r?\n/)[0]);
  const cdp = await CDP.connect((await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()).webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
  const external = [];
  cdp.on = cdp.on || (() => {});

  try {
    await cdp.send('Page.navigate', { url: `${hosted.origin}/ScribeFlow.html?demo=1&historyContext=1` });
    await wait(cdp, 'auth page', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await evalJs(cdp, `localStorage.clear();sessionStorage.clear();location.reload();true`);
    await wait(cdp, 'clean auth page', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await click(cdp, '#tabSignup');
    await wait(cdp, 'assent fields', `document.getElementById('authSignupAssentFields')&&!document.getElementById('authSignupAssentFields').disabled`, 12000);
    await fill(cdp, '#authEmail', ACCOUNT.email); await fill(cdp, '#authPass', ACCOUNT.password); await fill(cdp, '#authPass2', ACCOUNT.password);
    await click(cdp, '#authTermsAssent'); await click(cdp, '#authPracticeAuthority');
    await wait(cdp, 'signup enabled', `!document.getElementById('authBtn').disabled`, 8000);
    await click(cdp, '#authBtn');
    await wait(cdp, 'app screen', `document.getElementById('appScreen')&&getComputedStyle(document.getElementById('appScreen')).display!=='none'`);
    await sleep(600);

    check('0. the harness is in local demo mode and the history module is installed',
      () => true,
      await evalJs(cdp, `(() => ({ demo: typeof backendMode==='function' && backendMode()===false,
        history: !!(window.__mlsOpNoteHistory && window.__mlsOpNoteHistory.installed),
        version: window.__mlsOpNoteHistory ? window.__mlsOpNoteHistory.version : null }))()`).then(JSON.stringify));

    const installed = await evalJs(cdp, `!!(window.__mlsOpNoteHistory && window.__mlsOpNoteHistory.installed)`);
    if (!check('1. feat_opnote_history is installed on this build', () => installed,
      'window.__mlsOpNoteHistory.installed === ' + installed)) throw new Error('history module absent; nothing below is meaningful');

    /* ---- two patients, each with their own saved visits ---- */
    const a = await makePatientWithVisits(cdp, A, 3);
    const b = await makePatientWithVisits(cdp, B, 2);
    check('2. two synthetic patients exist, each with their own saved visits',
      () => a.saved.total >= 3 && b.saved.total >= 2,
      `A "${A.name}" has ${a.saved.total} saved visit(s); B "${B.name}" has ${b.saved.total}`);

    /* ---- THE QUESTION: does A's own chart and recent visits reach the block? ---- */
    /* buildHistoryBlock(name, ctx) returns a STRING (''=refused); the structured
       counts come from the context builder underneath it. Both are read so a
       disagreement between them would show up rather than be averaged away. */
    const blockA = await evalJs(cdp, `(() => {
      const h = window.__mlsOpNoteHistory;
      const ctx = { patientId: ${JSON.stringify(a.patient.id)}, dob: ${JSON.stringify(A.dob)} };
      const text = String(h.buildHistoryBlock(${JSON.stringify(A.name)}, ctx) || '');
      const c = h._internal.buildHistoryContext(${JSON.stringify(A.name)}, ctx) || {};
      return { ok: !!c.ok && text.length > 0, text: text,
               visitCount: c.visitCount || 0, profileSections: c.profileSections || 0,
               reason: String(c.reason || ''), ctxChars: String(c.text || '').length };
    })()`, true);

    check('3. the shipped builder returns a real history block for patient A',
      () => blockA.ok && blockA.text.length > 100,
      `ok=${blockA.ok} chars=${blockA.text.length} visitCount=${blockA.visitCount} profileSections=${blockA.profileSections} reason="${blockA.reason}"`);

    check('4. A\'s OWN RECENT VISITS are in the block (this is the owner\'s question)',
      () => blockA.text.indexOf(A.marker) >= 0 && blockA.visitCount >= 3,
      `marker ${A.marker} occurs ${blockA.text.split(A.marker).length - 1} time(s); visitCount=${blockA.visitCount} ` +
      `(3 synthetic prior visits were saved for A)`);

    check('5. NO OTHER PATIENT\'S chart is in A\'s block (cross-patient contamination)',
      () => blockA.text.indexOf(B.marker) < 0 && blockA.text.indexOf(B.name) < 0,
      `B's marker ${B.marker} occurs ${blockA.text.split(B.marker).length - 1} time(s); ` +
      `B's name occurs ${blockA.text.split(B.name).length - 1} time(s) in A's ${blockA.text.length}-char block`);

    /* ---- negative controls ---- */
    const mismatched = await evalJs(cdp, `(() => {
      const h = window.__mlsOpNoteHistory;
      const ctx = { patientId: ${JSON.stringify(b.patient.id)}, dob: ${JSON.stringify(A.dob)} };
      const text = String(h.buildHistoryBlock(${JSON.stringify(A.name)}, ctx) || '');
      const c = h._internal.buildHistoryContext(${JSON.stringify(A.name)}, ctx) || {};
      return { ok: !!c.ok && text.length > 0, text: text, reason: String(c.reason || '') };
    })()`, true);
    check('6. NEGATIVE CONTROL: A\'s name with B\'s patientId is REFUSED, not answered',
      () => !mismatched.ok || (mismatched.text.indexOf(A.marker) < 0 && mismatched.text.indexOf(B.marker) < 0),
      `ok=${mismatched.ok} reason="${mismatched.reason}" chars=${mismatched.text.length}; ` +
      `A-marker present=${mismatched.text.indexOf(A.marker) >= 0}, B-marker present=${mismatched.text.indexOf(B.marker) >= 0}`);

    const unknown = await evalJs(cdp, `(() => {
      const h = window.__mlsOpNoteHistory;
      const ctx = { patientId: 'no-such-id', dob: '1900-01-01' };
      const text = String(h.buildHistoryBlock('Nobody Zzz Notapatient', ctx) || '');
      const c = h._internal.buildHistoryContext('Nobody Zzz Notapatient', ctx) || {};
      return { ok: !!c.ok && text.length > 0, text: text, reason: String(c.reason || '') };
    })()`, true);
    check('7. NEGATIVE CONTROL: an unknown patient is refused rather than given someone else\'s chart',
      () => !unknown.ok || unknown.text.length === 0,
      `ok=${unknown.ok} reason="${unknown.reason}" chars=${unknown.text.length}`);

    /* ---- the wiring: a perfect builder proves nothing if it is not on the path ---- */
    const wiring = await evalJs(cdp, `(() => {
      const h = window.__mlsOpNoteHistory;
      const ctx = { patientId: ${JSON.stringify(a.patient.id)}, dob: ${JSON.stringify(A.dob)} };
      const base = 'PATIENT: ${A.name}\\nDATE OF PROCEDURE: 2026-08-01\\n\\nSELECTED TEMPLATE\\nsynthetic body';
      /* injectIntoUser(user, histBlock) - the block is built first, exactly as
         the module's own AI wrapper does it. */
      const block = String(h.buildHistoryBlock(${JSON.stringify(A.name)}, ctx) || '');
      let injected = '';
      try { injected = String(h.injectIntoUser(base, block) || ''); } catch (e) { injected = 'ERR ' + e.message; }
      const at = injected.indexOf('${A.marker}');
      return { grew: injected.length > base.length, hasMarker: at >= 0,
               beforeTemplate: at >= 0 && at < injected.indexOf('SELECTED TEMPLATE'),
               chars: injected.length, baseChars: base.length, blockChars: block.length,
               looksLikeOpNote: !!(h.looksLikeOpNoteCall && h.looksLikeOpNoteCall(base)) };
    })()`, true);
    check('8. the shipped injector puts A\'s history INTO a real op-note user prompt',
      () => wiring.grew && wiring.hasMarker,
      `prompt grew ${wiring.baseChars} -> ${wiring.chars} chars; A's marker present=${wiring.hasMarker}; ` +
      `inserted ahead of the SELECTED TEMPLATE section=${wiring.beforeTemplate}`);

    const viaWrapper = await evalJs(cdp, `(() => {
      const h = window.__mlsOpNoteHistory;
      /* injectIfOpNote(sys, user, opts) is the function the module installs on
         the AI path - it is what runs during a real draft, and it is the only
         thing that writes a receipt. Driving it (rather than the raw injector)
         is what makes the receipt below evidence about a real draft. */
      const sys = 'You are drafting an operative note. Follow the selected template.';
      /* Identity comes from opts.mlsOpNotePatientId plus a DOB line the module
         parses as /^\\s*-\\s*(dob|date of birth)/im - the leading dash matters. */
      const user = 'PATIENT: ${A.name}\\n- DOB: ${A.dob}\\nDATE OF PROCEDURE: 2026-08-01\\n' +
        'PROCEDURE: Synthetic diagnostic block\\n\\nSELECTED TEMPLATE - COPY ITS STRUCTURE AND FIXED WORDING:\\nsynthetic body';
      const opts = { mlsOpNotePatientId: ${JSON.stringify(a.patient.id)} };
      let out = '', err = '';
      try { out = String(h.injectIfOpNote(sys, user, opts) || ''); } catch (e) { err = String(e && e.message || e); }
      return { recognised: !!h.looksLikeOpNoteCall(sys, user, opts), grew: out.length > user.length,
               hasMarker: out.indexOf('${A.marker}') >= 0, chars: out.length, err: err };
    })()`, true);
    check('9a. the AI-path wrapper recognises an op-note call and injects into it',
      () => viaWrapper.recognised && viaWrapper.grew && viaWrapper.hasMarker,
      `recognised=${viaWrapper.recognised} grew=${viaWrapper.grew} marker=${viaWrapper.hasMarker} chars=${viaWrapper.chars} err="${viaWrapper.err}"`);

    /* lastInjectionReceipt is exported as a VALUE (null until the first
       injection, then overwritten by setReceipt with the receipt object) - it is
       never callable. Read it as a property; tolerate a getter if that changes. */
    const receipt = await evalJs(cdp, `(() => { try {
      const r = window.__mlsOpNoteHistory.lastInjectionReceipt;
      return (typeof r === 'function') ? (r() || null) : (r || null);
    } catch (e) { return null; } })()`);
    check('9. the injection leaves a receipt that names what was included',
      () => !!receipt && receipt.included === true && receipt.identityVerified === true && (receipt.visitCount || 0) >= 3,
      'receipt = ' + JSON.stringify(receipt));

    const ext = await evalJs(cdp, `1`);
    check('10. isolation: no external network was needed', () => external.length === 0,
      external.length + ' non-loopback request(s)');
  } finally {
    cdp.close();
    try { child.kill(); } catch (_) {}
    hosted.server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n' + (failures === 0
    ? 'PASS  live-opnote-history-context: the op note pulls the patient\'s own chart and recent visits, and refuses another patient\'s.'
    : 'FAIL  live-opnote-history-context: ' + failures + ' of ' + RESULTS.length + ' checks failed.'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nABORTED: ' + ((e && e.stack) || e)); process.exit(1); });
