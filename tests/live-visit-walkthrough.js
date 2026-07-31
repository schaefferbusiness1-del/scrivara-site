'use strict';
/*
 * A VISIT, WALKED END TO END, COUNTING CLICKS AND WATCHING FOR JUMPS
 * -----------------------------------------------------------------------------
 * Owner, verbatim: "do a walk throguth of a visit as a lot of little bugs are in
 * the walk threoguth like clicking record to generatating note to reviewing like
 * why do u have to clikc review and sign twice and why in the world does it jump
 * me to the advanced tools section when I clikc it somesimes".
 *
 * Two specific complaints, and both are MEASURABLE, so this harness measures
 * them instead of reasoning about them:
 *
 *   CLICK COUNT - every control is pressed ONCE. If one press does not move the
 *   workflow, that is recorded as "needed N presses", with the state before and
 *   after each one. A workflow step that silently needs two presses is the
 *   defect; a step that deliberately ARMS and says so is not, and the two are
 *   told apart by whether the app announced the second press.
 *
 *   UNREQUESTED NAVIGATION - window.__mlsCurrentView and the visible tool
 *   panels are sampled before and after every press. Any press that changes the
 *   route without being a navigation control is reported with the route it
 *   landed on. "It jumps me to advanced tools" is exactly this shape.
 *
 * It drives the app the way a clinician does - through visible controls, never
 * by calling internals - and serves only what _config.yml publishes, so it walks
 * the build the doctor actually receives.
 *
 * The model is stubbed before boot (no network, no key): the walkthrough is
 * about the WORKFLOW, and a real model call would make the run non-deterministic
 * without testing anything this file claims to test.
 *
 * PHI-free: one obviously synthetic patient, one obviously synthetic transcript.
 * The extension is never loaded or exercised.
 *
 *   node tests/live-visit-walkthrough.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACCOUNT = { email: 'clinician.walkthrough@mls.local', password: 'SyntheticOnly2026!' };
const PATIENT = { name: 'Synthetic Walkthrough Patient', mrn: 'SYN-WALK-0001', dob: '1975-03-14', sex: 'Female' };
const TRANSCRIPT = 'SYNTHETIC TRANSCRIPT - NOT A REAL PATIENT ENCOUNTER. '
  + 'Patient reports ongoing low back pain, unchanged since the last visit. No new numbness or weakness. '
  + 'Exam shows lumbar paraspinal tenderness. Plan: continue current therapy, follow up in six weeks.';

let failures = 0;
const FINDINGS = [];
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  FINDINGS.push({ label: label, detail: String(detail || '') });
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function note(msg) { console.log('  note  ' + msg); }

function findChrome() {
  const c = [process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return c.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || '';
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
/* The published tree, read from the inventory CI verifies against a real Jekyll
   build - never re-derived here. See tests/published-tree.js for the two ways
   deriving it went wrong. */
const isPublished = require('./published-tree.js').makeIsPublished();
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'ScribeFlow.html';
    if (!isPublished(rel)) { res.writeHead(404); return res.end('not published by GitHub Pages'); }
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
  send(m, p, t) { const id = this.id++; return new Promise((res, rej) => {
    const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(m + ': timeout')); }, t || 40000);
    this.pending.set(id, { resolve: res, reject: rej, timer, method: m });
    this.socket.send(JSON.stringify({ id, method: m, params: p || {} })); }); }
  close() { try { this.socket.close(); } catch (_) {} }
}
async function evalJs(cdp, e, aw) {
  const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: !!aw });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result && r.result.value;
}
async function wait(cdp, name, expr, t) {
  const dl = Date.now() + (t || 30000);
  for (;;) { let v = null; try { v = await evalJs(cdp, `(()=>{try{return (${expr});}catch(e){return false;}})()`); } catch (_) {}
    if (v) return v; if (Date.now() > dl) throw new Error('timed out waiting for ' + name); await sleep(150); }
}
async function fill(cdp, sel, v) {
  await evalJs(cdp, `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 0;el.focus();
    const P=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(P,'value').set.call(el,${JSON.stringify(v)});
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    el.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
}

/* the state the walkthrough judges by */
const STATE = `(() => ({
  view: String(window.__mlsCurrentView || ''),
  noteChars: (document.getElementById('noteBox') || {}).value ? document.getElementById('noteBox').value.length : 0,
  signVisible: (() => { const l = document.getElementById('signLine'); return !!(l && getComputedStyle(l).display !== 'none'); })(),
  signDisabled: (() => { const b = document.getElementById('signBtn'); return b ? !!b.disabled : null; })(),
  toast: (() => { const t = document.getElementById('toast'); return (t && t.classList.contains('show')) ? String(t.textContent || '').slice(0,140) : ''; })(),
  openPanels: [...document.querySelectorAll('.modal-bg.show')].map(e => e.id).filter(Boolean),
  /* the "advanced tools" surfaces the owner says he gets thrown into */
  advancedOpen: ['moreToolsWrap','visitToolsWrap','mlsToolsMenu','advancedTools','emrWbAthena']
    .filter(id => { const e = document.getElementById(id); if (!e) return false;
      const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().height > 0; }),
  scrollY: Math.round(window.scrollY || 0)
}))()`;

/* press a visible control ONCE by id; report what changed */
async function press(cdp, id) {
  const before = await evalJs(cdp, STATE);
  const clicked = await evalJs(cdp, `(()=>{const el=document.getElementById(${JSON.stringify(id)});
    if(!el) return {ok:false,why:'absent'};
    const s=getComputedStyle(el), r=el.getBoundingClientRect();
    if(s.display==='none'||s.visibility==='hidden'||r.width<=0||r.height<=0) return {ok:false,why:'not visible'};
    if(el.disabled) return {ok:false,why:'disabled'};
    el.scrollIntoView({block:'center'}); el.click(); return {ok:true};})()`);
  await sleep(900);
  const after = await evalJs(cdp, STATE);
  return { id, clicked, before, after };
}

async function main() {
  const exe = findChrome();
  if (!exe) { console.log('  SKIP  no Chrome found; set CHROME_PATH.'); process.exit(0); }
  const hosted = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-walk-'));
  const flags = ['--no-sandbox', '--headless=new', '--hide-scrollbars', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--window-size=1440,900', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'];
  const child = spawn(exe, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  const pf = path.join(profile, 'DevToolsActivePort');
  const dl = Date.now() + 25000;
  while (!fs.existsSync(pf) && Date.now() < dl) await sleep(50);
  let t = ''; for (let i = 0; i < 120 && !t.trim(); i++) { try { t = fs.readFileSync(pf, 'utf8'); } catch (_) {} if (!t.trim()) await sleep(50); }
  const port = Number(t.trim().split(/\r?\n/)[0]);
  const cdp = await CDP.connect((await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()).webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);

  /* deterministic model stub, installed before the app boots */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (function(){ var of = window.fetch.bind(window);
      window.fetch = function(input, init){
        var url=''; try{ url = (typeof input==='string')?input:(input&&input.url)||''; }catch(e){}
        if(!/\\/api\\/(complete|generate)|api\\.openai\\.com/.test(String(url))) return of(input, init);
        var note = 'SYNTHETIC NOTE - NOT A REAL PATIENT DOCUMENT\\n\\nS: Synthetic subjective.\\nO: Synthetic objective.\\nA: Synthetic assessment.\\nP: Synthetic plan.';
        return Promise.resolve(new Response(JSON.stringify({ choices:[{message:{content: JSON.stringify({ note: note, missing: [] })}}], content: note, result: note }),
          { status:200, headers:{'Content-Type':'application/json'} }));
      };
    })();
    window.__walkAi = { calls: 0, errors: [], toasts: [] };
    addEventListener('error', function(e){ try{ window.__walkAi.errors.push(String(e.message||e)); }catch(_){}}, true);
    addEventListener('unhandledrejection', function(e){ try{ window.__walkAi.errors.push('rejection: '+String((e.reason&&e.reason.message)||e.reason)); }catch(_){}});
    (function(){
      var iv = setInterval(function(){
        try{
          if (typeof window.aiCallRaw === 'function' && !window.aiCallRaw.__walkWrapped) {
            var orig = window.aiCallRaw;
            var w = function(){ window.__walkAi.calls++; return orig.apply(this, arguments); };
            w.__walkWrapped = true; window.aiCallRaw = w; clearInterval(iv);
          }
        }catch(_){}
      }, 200);
      setTimeout(function(){ try{ clearInterval(iv); }catch(_){}}, 30000);
    })();` });

  try {
    console.log('WALKTHROUGH - one synthetic visit, every control pressed once\n');
    await cdp.send('Page.navigate', { url: `${hosted.origin}/ScribeFlow.html?demo=1&walkthrough=1` });
    await wait(cdp, 'auth', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await evalJs(cdp, `localStorage.clear();sessionStorage.clear();location.reload();true`);
    await wait(cdp, 'auth2', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await sleep(1500);
    await evalJs(cdp, `document.getElementById('tabSignup').click();1`);
    await wait(cdp, 'assent', `document.getElementById('authSignupAssentFields')&&!document.getElementById('authSignupAssentFields').disabled`, 12000);
    await fill(cdp, '#authEmail', ACCOUNT.email); await fill(cdp, '#authPass', ACCOUNT.password); await fill(cdp, '#authPass2', ACCOUNT.password);
    await evalJs(cdp, `document.getElementById('authTermsAssent').click();document.getElementById('authPracticeAuthority').click();1`);
    await wait(cdp, 'enabled', `!document.getElementById('authBtn').disabled`, 8000);
    await evalJs(cdp, `document.getElementById('authBtn').click();1`);
    await wait(cdp, 'app', `document.getElementById('appScreen')&&getComputedStyle(document.getElementById('appScreen')).display!=='none'`);
    /* #appScreen showing is NOT the app being visible. While the secure loading
       gate holds `mls-secure-loading` on <html>, every body child except the
       loading card is visibility:hidden!important - and el.click() works
       straight through that, so a walkthrough can complete an entire visit on a
       blank screen and call it a pass. Wait for the gate, and wait for it with
       the CDP wire QUIET: measured in tests/live-loading-gate-lifetime.js, a
       150ms Runtime.evaluate poll starved the page's timer queue so completely
       that a 100ms interval ticked ZERO times in 45 seconds. The gate's whole
       recovery vocabulary is setTimeout, so polling it is polling it to death.
       A one-second cadence leaves the page whole seconds of uninterrupted
       thread, and the healthy reveal measures ~2.7s. */
    for (let i = 0; i < 45; i++) {
      const gate = await evalJs(cdp, `(()=>{var h=document.documentElement;
        return h.classList.contains('mls-secure-loading')||h.classList.contains('mls-app-revealing');})()`);
      if (!gate) break;
      await sleep(1000);
    }
    ok(await evalJs(cdp, `!document.documentElement.classList.contains('mls-secure-loading')`),
      '0. the app is actually painted before the walkthrough starts',
      'the secure loading gate was still up, so everything below would have been measured on an invisible app');
    await sleep(2500);

    /* In ?demo=1 the app generates with a per-device key and refuses without one
       (ScribeFlow.html:19667). Seed an obviously synthetic one; the pre-boot
       fetch stub answers the call, so nothing leaves the machine. */
    const keyed = await evalJs(cdp, `(()=>{ try{
      const k = (typeof uns==='function') ? uns('apikey') : 'apikey';
      localStorage.setItem(k, 'sk-SYNTHETIC-walkthrough-key-not-real');
      return { key:k, ok: !!(typeof getKey==='function' && getKey()) };
    }catch(e){ return { err:String(e&&e.message||e) }; } })()`);
    note('model key seeded: ' + JSON.stringify(keyed));

    /* ---- 1. a patient ---- */
    await evalJs(cdp, `document.querySelector('#mlsDock button[data-dest="patient"]').click();1`);
    await wait(cdp, 'patients', `window.__mlsCurrentView==='patients'`);
    await evalJs(cdp, `document.getElementById('ptNewBtn').click();1`);
    await wait(cdp, 'new patient', `document.getElementById('patientModal').classList.contains('show')`);
    await fill(cdp, '#ptName', PATIENT.name); await fill(cdp, '#ptMrn', PATIENT.mrn); await fill(cdp, '#ptDob', PATIENT.dob);
    await evalJs(cdp, `document.querySelector('#patientModal button[onclick="savePatient()"]').click();1`);
    await wait(cdp, 'patient saved', `(()=>{const p=window.activePatient&&window.activePatient();return !!(p&&p.name===${JSON.stringify(PATIENT.name)});})()`, 12000);
    ok(true, '1. a synthetic patient exists and is selected');

    /* ---- 2. the visit surface ---- */
    await evalJs(cdp, `document.querySelector('#mlsDock button[data-dest="visit"]').click();1`);
    await wait(cdp, 'visit', `window.__mlsCurrentView==='visit'`);
    await sleep(1200);
    ok(true, '2. the Visit workspace opened');

    /* THE STATE THE DOCTOR ACTUALLY STARTS IN: nothing recorded yet. This is
       where Record, the Advanced-workspace escape hatch and Generate coexist,
       and where a mis-tap can land on the wrong one. */
    const startRow = await evalJs(cdp, `(()=>{ const r=document.querySelector('.ez3fl-record'); if(!r) return null;
      return [...r.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();const st=getComputedStyle(b);
        return { id:b.id||'(none)', cls:String(b.className||''), text:String(b.textContent||'').trim().slice(0,32),
                 left:Math.round(q.left), right:Math.round(q.right), w:Math.round(q.width), h:Math.round(q.height),
                 visible: st.display!=='none' && st.visibility!=='hidden' && q.height>0 };})
        .filter(x=>x.visible).sort((a,b)=>a.left-b.left);})()`);
    note('EMPTY-transcript record row: ' + JSON.stringify(startRow));
    if (startRow && startRow.length >= 2) {
      const adv = startRow.find(b => /openws/.test(b.cls) || /advanced/i.test(b.text));
      const rec = startRow.find(b => /ez3fl-rec\b/.test(b.cls) || /record/i.test(b.text));
      const gen = startRow.find(b => /ez3flGen/.test(b.id));
      if (adv && rec) {
        const wedged = gen ? (adv.left > rec.left && adv.left < gen.left) : false;
        ok(!wedged, '2b. the Advanced-workspace escape hatch is not wedged between the primary actions',
          JSON.stringify({ Record: rec.left, Advanced: adv.left, Generate: gen ? gen.left : null }));
        ok(adv.h >= 44 || adv.left >= rec.right,
          '2c. the Advanced-workspace button is separated from Record',
          'Record ends at ' + rec.right + ', Advanced starts at ' + adv.left);
      } else { note('Advanced/Record not both visible in the empty state: ' + JSON.stringify({adv:!!adv, rec:!!rec})); }
    }

    /* ---- 3. a transcript (the paste path; recording needs a mic) ---- */
    /* Type into the transcript box the doctor can actually SEE. The Easy lane
       owns #ez3flTranscript and syncs it down to the advanced #transcript; the
       reverse is not true, so writing to #transcript leaves the visible lane
       thinking nothing was captured and Generate refuses. That cost this
       harness two wrong conclusions before it was caught. */
    const wrote = await evalJs(cdp, `(()=>{
      const set=(el,v)=>{ if(!el) return 0; el.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el, v);
        el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
        el.dispatchEvent(new Event('change',{bubbles:true})); return el.value.length; };
      const top=document.getElementById('ez3flTranscript');
      const adv=document.getElementById('transcript');
      const n = set(top, ${JSON.stringify(TRANSCRIPT)}) || set(adv, ${JSON.stringify(TRANSCRIPT)});
      return { chars:n, usedTop: !!top }; })()`);
    ok(!!(wrote && wrote.chars), '3. a synthetic transcript is in the visible box', JSON.stringify(wrote));
    await sleep(800);

    /* ---- 3b. WHAT generate control is actually on screen? ---- */
    const genCandidates = await evalJs(cdp, `(()=>{
      const ids=['genBtn','ez3flGen','ez3Gen','mlsGenBtn'];
      const out=ids.map(id=>{const e=document.getElementById(id);
        if(!e) return {id,exists:false};
        const s=getComputedStyle(e), r=e.getBoundingClientRect();
        return {id,exists:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&r.height>0,disabled:!!e.disabled,text:String(e.textContent||'').trim().slice(0,30)};});
      const others=[...document.querySelectorAll('button')].filter(b=>/generat/i.test(b.textContent||''))
        .filter(b=>{const s=getComputedStyle(b),r=b.getBoundingClientRect();return s.display!=='none'&&r.height>0;})
        .map(b=>({id:b.id||'(no id)',text:String(b.textContent||'').trim().slice(0,34),disabled:!!b.disabled}));
      return {known:out, visibleGenerateButtons:others};})()`);
    note('generate controls: ' + JSON.stringify(genCandidates));

    /* ---- 4d. the record row: where is the escape hatch relative to the
       two primary actions? "It jumps me to advanced tools" is what a mis-tap on
       a button wedged between Record and Generate looks like. ---- */
    const row = await evalJs(cdp, `(()=>{ const r=document.querySelector('.ez3fl-record'); if(!r) return null;
      return [...r.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();const s=getComputedStyle(b);
        return { id:b.id||'(none)', cls:String(b.className||''), text:String(b.textContent||'').trim().slice(0,30),
                 left:Math.round(q.left), width:Math.round(q.width), order:s.order,
                 visible: s.display!=='none' && q.height>0 };}).filter(x=>x.visible);})()`);
    note('record row, left-to-right: ' + JSON.stringify(row));
    if (row && row.length >= 3) {
      const adv = row.find(b => /openws|advanced/i.test(b.cls + ' ' + b.text));
      const gen = row.find(b => /ez3flGen/.test(b.id));
      const rec = row.find(b => /record/i.test(b.text) || /ez3fl-rec/.test(b.cls));
      if (adv && gen && rec) {
        ok(!(adv.left > rec.left && adv.left < gen.left),
          '4d. the Advanced-workspace escape hatch is NOT wedged between Record and Generate',
          'left-to-right: Record@' + rec.left + ', Advanced@' + adv.left + ', Generate@' + gen.left +
          ' - a mis-tap between the two primary actions opens the advanced workspace, which is exactly what "it jumps me to the advanced tools section" looks like');
      }
    }

    /* ---- 4. generate ---- */
    const genId = await evalJs(cdp, `(()=>{
      const pref=['genBtn','ez3flGen','ez3Gen'];
      for(const id of pref){const e=document.getElementById(id);if(!e)continue;
        const s=getComputedStyle(e),r=e.getBoundingClientRect();
        if(s.display!=='none'&&r.height>0&&!e.disabled) return id;}
      const b=[...document.querySelectorAll('button')].find(x=>/generat/i.test(x.textContent||'')&&!x.disabled&&x.getBoundingClientRect().height>0);
      if(b){ if(!b.id) b.id='mlsWalkGen'; return b.id; }
      return '';})()`);
    note('pressing generate control: ' + (genId || '(none found)'));
    const gen = await press(cdp, genId || 'genBtn');
    let genPresses = 1;
    if (gen.clicked.ok) {
      try { await wait(cdp, 'a note', `(()=>{const b=document.getElementById('noteBox');return !!(b&&String(b.value||'').trim().length>40);})()`, 45000); }
      catch (_) {
        const again = await press(cdp, genId || 'genBtn'); genPresses = 2;
        try { await wait(cdp, 'a note (2nd press)', `(()=>{const b=document.getElementById('noteBox');return !!(b&&String(b.value||'').trim().length>40);})()`, 45000); } catch (__) {}
        note('Generate needed a second press. First press left: ' + JSON.stringify(again.before.toast || '(no message)'));
      }
    }
    const diag = await evalJs(cdp, `(()=>{ const d=window.__walkAi||{};
      return { aiCalls:d.calls||0, errors:(d.errors||[]).slice(0,4),
        transcriptChars: (document.getElementById('transcript')||{}).value ? document.getElementById('transcript').value.length : 0,
        ez3Body: !!document.getElementById('mlsEz3Body'),
        noteWrapHidden: (()=>{const w=document.getElementById('ez3flNoteWrap'); return w? w.hasAttribute('hidden') : null;})(),
        anyToast: (()=>{const t=document.getElementById('toast'); return t?String(t.textContent||'').slice(0,160):'';})(),
        ez3Toast: (()=>{const t=document.getElementById('ez3Toast'); return t?String(t.textContent||'').slice(0,160):'';})() };})()`);
    note('generate diagnostics: ' + JSON.stringify(diag));
    const afterGen = await evalJs(cdp, STATE);
    ok(afterGen.noteChars > 40, '4. GENERATE produced a note', 'chars=' + afterGen.noteChars + ', presses=' + genPresses);
    ok(genPresses === 1, '4b. Generate needed exactly ONE press', 'needed ' + genPresses);
    ok(!afterGen.advancedOpen.length, '4c. generating did not throw open an advanced-tools panel',
      'opened: ' + JSON.stringify(afterGen.advancedOpen));

    /* ---- 5pre. THE CONTROL THE OWNER ACTUALLY CALLS "REVIEW & SIGN" ----
       Everything below presses #signBtn, which is the SIGN half. The owner's
       words were "why do u have to clikc review and sign twice", and the button
       he is looking at while saying that is the lane's own
       "Next: Review & send to Athena" (#ez3flReview) - the single most
       prominent thing on the screen once a note exists. This harness never
       touched it, so it could not have seen his complaint even in principle.
       Press it ONCE and record exactly what a doctor would see happen: did the
       review surface open, did anything move, or did the press land on nothing?
       No verdict is asserted here yet - the measurement comes first. */
    const reviewProbe = await evalJs(cdp, `(()=>{
      const b=document.getElementById('ez3flReview');
      if(!b) return {present:false};
      const s=getComputedStyle(b), r=b.getBoundingClientRect();
      const send=document.getElementById('pushAllEmrBtn');
      const sr=send?send.getBoundingClientRect():null, ss=send?getComputedStyle(send):null;
      return {present:true, label:String(b.innerText||'').trim(),
        visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,
        sendPresent:!!send, sendInlineHidden: !!(send&&send.style&&send.style.display==='none'),
        sendVisible: !!(send&&ss.display!=='none'&&ss.visibility!=='hidden'&&sr.width>0&&sr.height>0),
        sendInViewport: !!(sr&&sr.top>=0&&sr.bottom<=(window.innerHeight||0)),
        adv: document.body.classList.contains('ez3adv'), scrollY: Math.round(window.scrollY||0)};
    })()`);
    note('BEFORE pressing the lane Review control: ' + JSON.stringify(reviewProbe));
    if (reviewProbe.present && reviewProbe.visible) {
      /* WHO MOVES THE PAGE? Trap every scroll API with a stack, so the culprit
         names itself instead of being guessed at.
         This is not decoration. The first version of this check reported the
         page jumping 575px on one press of Review and I began fixing the app
         for it - a quiet-flag race in mls-connect.js that I could argue for and
         could not demonstrate. The trace then attributed the entire movement,
         unambiguously, to `scrollIntoView` on #ez3flReview called by this
         harness's own press() helper. The app had never moved the page. The
         fix was reverted and this trace stayed, because a scroll assertion
         without one is an assertion about the instrument. */
      await evalJs(cdp, `(()=>{
        window.__scrollTrace=[];
        const rec=(how,extra)=>{ try{ window.__scrollTrace.push({how, y:Math.round(window.scrollY||0),
          extra:extra||'', stack:String(new Error().stack||'').split('\\n').slice(1,7).join(' | ')}); }catch(e){} };
        const sivEl=Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView=function(){ rec('scrollIntoView', (this.id||this.className||this.tagName)); return sivEl.apply(this,arguments); };
        const st=window.scrollTo; window.scrollTo=function(){ rec('scrollTo', JSON.stringify([].slice.call(arguments).slice(0,2))); return st.apply(window,arguments); };
        const sb=window.scrollBy; window.scrollBy=function(){ rec('scrollBy', JSON.stringify([].slice.call(arguments).slice(0,2))); return sb.apply(window,arguments); };
        const fo=HTMLElement.prototype.focus; HTMLElement.prototype.focus=function(o){ if(!(o&&o.preventScroll)) rec('focus(no preventScroll)', (this.id||this.tagName)); return fo.apply(this,arguments); };
        addEventListener('scroll',()=>{ try{ if(window.__scrollTrace.length<60) window.__scrollTrace.push({how:'(scroll event)', y:Math.round(window.scrollY||0)}); }catch(e){} }, {passive:true});
        return 1; })()`);
      /* PRESS IT WITHOUT SCROLLING IT. press() calls scrollIntoView first, which
         is right for a control that may be off-screen and fatal for a probe that
         measures scroll: the first version of this check blamed the app for
         575px of movement that the SCROLL TRACE then attributed, unambiguously,
         to the harness's own scrollIntoView on #ez3flReview. The control is
         already visible here (asserted above), so it is clicked where it sits
         and the baseline is taken in the same expression as the click. */
      const clickBase = await evalJs(cdp, `(()=>{
        const b=document.getElementById('ez3flReview');
        const y=Math.round(window.scrollY||0);
        b.click();
        return {yAtClick:y};})()`);
      await sleep(2200);
      const trace = await evalJs(cdp, `(()=>{
        const t=(window.__scrollTrace||[]).filter(x=>x.how!=='(scroll event)');
        return {calls:t.slice(0,8), scrollEvents:(window.__scrollTrace||[]).filter(x=>x.how==='(scroll event)').length,
                finalY:Math.round(window.scrollY||0)}; })()`);
      note('SCROLL TRACE: ' + JSON.stringify(trace));
      const afterReview = await evalJs(cdp, `(()=>{
        const send=document.getElementById('pushAllEmrBtn');
        const sr=send?send.getBoundingClientRect():null, ss=send?getComputedStyle(send):null;
        return {sendVisible: !!(send&&ss.display!=='none'&&ss.visibility!=='hidden'&&sr.width>0&&sr.height>0),
          sendInViewport: !!(sr&&sr.top>=0&&sr.bottom<=(window.innerHeight||0)),
          sendFocused: document.activeElement===send,
          adv: document.body.classList.contains('ez3adv'),
          scrollY: Math.round(window.scrollY||0),
          openPanels: [...document.querySelectorAll('.modal-bg.show')].map(e=>e.id).filter(Boolean),
          toast: (()=>{const t=document.getElementById('toast');
            return (t&&t.classList.contains('show'))?String(t.textContent||'').slice(0,160):'';})()};
      })()`);
      note('AFTER one press of "' + reviewProbe.label + '": ' + JSON.stringify(afterReview));
      /* The press has to DO something a doctor can see. Any of these counts:
         a review panel opened, the send control came into view, or the app said
         something. If none of them is true the button looked broken, and a
         button that looks broken gets pressed again - which is the report. */
      const didSomething = afterReview.openPanels.length > 0 || afterReview.toast ||
        (afterReview.sendInViewport && !reviewProbe.sendInViewport) ||
        (afterReview.sendVisible && !reviewProbe.sendVisible);
      ok(didSomething, '5pre. one press of the lane Review control visibly does something',
        'pressing "' + reviewProbe.label + '" opened no panel, said nothing, and moved nothing into view: '
          + JSON.stringify({ before: reviewProbe, after: afterReview })
          + '. A press with no visible result is the one that gets pressed twice.');

      /* THE PAGE MUST NOT MOVE. Owner, twice: "when I click review and sign it
         should not scroll me down", and "why in the world does it jump me to
         the advanced tools section". Measured before the fix: scrollY 157 ->
         732 on a single press, 575px of unrequested movement, while the toast
         printed "the page has been left exactly where you are". */
      const scrolled = Math.abs((afterReview.scrollY || 0) - (clickBase.yAtClick || 0));
      ok(scrolled <= 4, '5pre-b. pressing Review does not move the page',
        'the page jumped ' + scrolled + 'px (' + reviewProbe.scrollY + ' -> ' + afterReview.scrollY
          + ') on one press of "' + reviewProbe.label + '", measured from the scroll position at the instant of the click. '
          + 'Scroll trace: ' + JSON.stringify(trace));

      /* AND THE TOAST MUST NOT CLAIM OTHERWISE. A promise about the viewport is
         checkable, so it gets checked: the app may only say it left the page
         alone if it did. */
      const claimsStill = /left exactly where you are/i.test(afterReview.toast || '');
      ok(!(claimsStill && scrolled > 4), '5pre-c. the app does not claim it left the page still while moving it',
        'the toast said "left exactly where you are" after moving the page ' + scrolled + 'px: '
          + JSON.stringify(afterReview.toast));
    } else {
      note('the lane Review control is not offered in this state: ' + JSON.stringify(reviewProbe));
    }

    /* ---- 5blank. THE REFUSAL HAS TO BE VISIBLE TO THE DOCTOR ----
       This is the strongest remaining candidate for "why do u have to clikc
       review and sign twice", and the synthetic note above cannot produce it
       because it has no placeholders. A REAL op note does.

       signNote() refuses when opNoteBlankTokens() finds any unresolved field,
       and b806 made that refusal helpful by selecting the first blank so the
       doctor is taken to the problem. But it selects it in #noteBox - and in
       the lane flow the doctor is looking at #ez3flNote, a different textarea
       that mirrors into #noteBox, while #noteBox itself lives inside the
       ADVANCED WORKSPACE, which is closed by default. focus() and
       setSelectionRange() on an element inside a display:none subtree are
       silent no-ops. If that is what happens, the doctor reads a toast, sees
       nothing move, and presses again - which is exactly the report.

       So: put a blank in the note through the visible editor, press Sign once,
       and require that whatever the app selected is somewhere he can SEE. */
    const blankProbe = await evalJs(cdp, `(()=>{
      const lane=document.getElementById('ez3flNote'), real=document.getElementById('noteBox');
      if(!real) return {skip:'no #noteBox'};
      const target = (lane && getComputedStyle(lane).display!=='none') ? lane : real;
      const withBlank = String(real.value||'') + '\\n\\nLATERALITY: [FILL: side]\\n';
      const P = HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(P,'value').set.call(target, withBlank);
      target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
      return {ok:true, editedVia: target.id, mirrored: String(real.value||'').indexOf('[FILL: side]')>=0};
    })()`);
    if (blankProbe.ok) {
      await sleep(500);
      const mirrored = await evalJs(cdp, `String((document.getElementById('noteBox')||{}).value||'').indexOf('[FILL: side]')>=0`);
      ok(mirrored, '5blank-a. what the doctor types in the lane reaches the real note',
        'typing into #' + blankProbe.editedVia + ' did not mirror into #noteBox, so the sign gate reads a different note than the one on screen');

      /* PRESS THE BUTTON HE ACTUALLY USES.
         This pressed #signBtn and passed, while the fix it was proving was dead
         on #ez3Sign - the "✔ Review & Sign" on the visit card, which is the
         control in front of the doctor in the lane. That driver called render()
         on a refusal, tearing #ez3flNote out of the DOM in the same click and
         taking the selection with it. Testing the reachable button instead of
         the used one is how a fix ships and changes nothing.
         Prefer the visit-card button; fall back to #signBtn only if the lane is
         not the surface in use, so this still means something in either shape. */
      const signId = await evalJs(cdp, `(()=>{
        const vis=id=>{const e=document.getElementById(id); if(!e) return false;
          const s=getComputedStyle(e), r=e.getBoundingClientRect();
          return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
        return vis('ez3Sign') ? 'ez3Sign' : 'signBtn';})()`);
      note('pressing the sign control the doctor sees: #' + signId);
      const sBlank = await press(cdp, signId);
      const refusal = await evalJs(cdp, `(()=>{
        const real=document.getElementById('noteBox'), lane=document.getElementById('ez3flNote');
        const vis=el=>{ if(!el) return false; const s=getComputedStyle(el), r=el.getBoundingClientRect();
          return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0; };
        const inView=el=>{ if(!vis(el)) return false; const r=el.getBoundingClientRect();
          return r.bottom>0 && r.top < (window.innerHeight||0); };
        const selLen = el => el && typeof el.selectionStart==='number' ? (el.selectionEnd-el.selectionStart) : 0;
        return {
          signed: !!(document.getElementById('signLine') && getComputedStyle(document.getElementById('signLine')).display!=='none'),
          realVisible: vis(real), realInView: inView(real), realSel: selLen(real),
          laneVisible: vis(lane), laneInView: inView(lane), laneSel: selLen(lane),
          active: document.activeElement ? (document.activeElement.id||document.activeElement.tagName) : '',
          adv: document.body.classList.contains('ez3adv')
        };
      })()`);
      note('sign refused with a blank present: ' + JSON.stringify(refusal));

      ok(!refusal.signed, '5blank-b. a note with an unresolved field is not signed',
        'the note signed with [FILL: side] still in it');
      ok(sBlank.after.toast && /unresolved field/i.test(sBlank.after.toast),
        '5blank-c. the refusal says why', 'toast was: ' + JSON.stringify(sBlank.after.toast));
      /* The point of the whole step: the doctor must be able to SEE the thing
         he is being asked to fix. Either editor counts - what must not happen
         is the app selecting a blank inside a closed workspace and calling that
         guidance. */
      const showedHim = (refusal.realInView && refusal.realSel > 0) || (refusal.laneInView && refusal.laneSel > 0);
      ok(showedHim, '5blank-d. the refusal takes him to a blank he can actually see',
        'the app refused and selected nothing visible: ' + JSON.stringify(refusal)
          + '. A refusal that moves nothing on screen is indistinguishable from a button that did not register, '
          + 'which is the "press it twice" report.');

      /* put the note back so step 5 below tests signing, not this */
      await evalJs(cdp, `(()=>{
        const real=document.getElementById('noteBox'), lane=document.getElementById('ez3flNote');
        const clean=String(real.value||'').replace(/\\n\\nLATERALITY: \\[FILL: side\\]\\n/,'');
        const P=HTMLTextAreaElement.prototype;
        const t=(lane && getComputedStyle(lane).display!=='none')?lane:real;
        Object.getOwnPropertyDescriptor(P,'value').set.call(t, clean);
        t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
        return 1;})()`);
      await sleep(400);
    }

    /* ---- 5. REVIEW & SIGN - the owner says this takes two presses ---- */
    const s1 = await press(cdp, 'signBtn');
    let signPresses = 1, signed = s1.after.signVisible;
    let s2 = null;
    if (!signed) {
      s2 = await press(cdp, 'signBtn'); signPresses = 2; signed = s2.after.signVisible;
    }
    ok(signed, '5. REVIEW & SIGN signed the note', 'signature line visible=' + signed + ', presses=' + signPresses);
    ok(signPresses === 1,
      '5b. Review & Sign needed exactly ONE press',
      'needed ' + signPresses + ' presses. After the first press the app said: '
        + JSON.stringify(s1.after.toast || '(nothing)')
        + '; signBtn disabled before=' + s1.before.signDisabled + ' after=' + s1.after.signDisabled
        + '. A step that needs two presses without announcing the second is the defect the owner reported.');

    /* ---- 6. UNREQUESTED NAVIGATION on every press so far ---- */
    const jumps = [gen, s1, s2].filter(Boolean).filter((p) => p.clicked.ok && p.before.view !== p.after.view);
    ok(jumps.length === 0, '6. no press changed the route without being asked to',
      jumps.map((j) => j.id + ': ' + j.before.view + ' -> ' + j.after.view).join('; '));
    const opened = [gen, s1, s2].filter(Boolean).filter((p) => p.clicked.ok && !p.before.advancedOpen.length && p.after.advancedOpen.length);
    ok(opened.length === 0, '6b. no press threw open an advanced-tools surface',
      opened.map((j) => j.id + ' opened ' + JSON.stringify(j.after.advancedOpen)).join('; '));

    /* ---- 6c. THE VISIT-SHORTCUT CHIPS MUST NOT THROW HIM INTO ADVANCED TOOLS.
       Every chip calls openWorkspace(false) - "open, but do not take me
       anywhere". That argument was unread until b807, so pressing a shortcut
       opened the advanced workspace AND smooth-scrolled the page. ---- */
    const chipProbe = await evalJs(cdp, `(()=>{
      const t=document.getElementById('ez3flToolsToggle'); if(!t) return {skip:'no shortcuts toggle'};
      t.click(); return {opened:true};})()`);
    await sleep(700);
    if (!chipProbe.skip) {
      const beforeChip = await evalJs(cdp, `({ y: Math.round(window.scrollY||0), adv: document.body.classList.contains('ez3adv') })`);
      const chip = await evalJs(cdp, `(()=>{ const b=[...document.querySelectorAll('.ez3fl-qchip')]
        .find(x=>/orders/i.test(x.textContent||'') && x.getBoundingClientRect().height>0);
        if(!b) return null; if(!b.id) b.id='mlsWalkChip'; b.click(); return b.id;})()`);
      if (chip) {
        await sleep(1800);
        const afterChip = await evalJs(cdp, `({ y: Math.round(window.scrollY||0), adv: document.body.classList.contains('ez3adv'),
          ordersInView: (()=>{const o=document.getElementById('visitOrdersCard'); if(!o) return null;
            const r=o.getBoundingClientRect(); return r.top>-50 && r.top<innerHeight;})() })`);
        note('shortcut chip: before=' + JSON.stringify(beforeChip) + ' after=' + JSON.stringify(afterChip));
        ok(afterChip.ordersInView !== false,
          '6c. a Visit-shortcut chip lands on what it names, not on the note card',
          'Orders card in view after pressing the Orders chip: ' + afterChip.ordersInView);
      } else { note('no Orders shortcut chip on this build'); }
    }

    /* ---- 7. the note reached History ---- */
    const inHistory = await evalJs(cdp, `(()=>{ try{ const p=window.activePatient(); const ns=(window.getNotes&&window.getNotes())||[];
      const mine=ns.filter(n=>n&&n.patientId===p.id); return { count:mine.length, signed: mine.filter(n=>n.signed).length }; }catch(e){ return {count:-1,signed:-1}; } })()`);
    ok(inHistory.count > 0, '7. the visit note is in History', JSON.stringify(inHistory));

    console.log('\n' + (failures === 0
      ? 'PASS  live-visit-walkthrough: record -> generate -> review & sign completes with one press per step and no unrequested navigation.'
      : 'FAIL  live-visit-walkthrough: ' + failures + ' step(s) did not behave.'));
  } finally {
    cdp.close();
    try { child.kill(); } catch (_) {}
    hosted.server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('WALKTHROUGH ABORTED: ' + ((e && e.stack) || e)); process.exit(1); });
