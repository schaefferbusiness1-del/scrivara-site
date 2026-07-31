'use strict';

/*
 * Real-Chrome proof for the same-origin clinical library boundary and the
 * production adjuncts that consume it. The page, patient, notes, and studies
 * are synthetic. Chrome uses a fresh profile, the local server is no-store,
 * and host resolution blocks every non-loopback destination.
 *
 * This remains separate from run-all.js because it launches Chrome and writes
 * a durable JSON artifact.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ARTIFACTS = path.join('tests', 'live-smoke-artifacts', 'local-adjunct-library-proof-20260718');
const PINNED = Object.freeze({
  chart: 'vendor/chart.umd-4.5.1.js?v=ecc3cd1eeb8c34d2',
  xlsx: 'vendor/xlsx.full-0.20.3.min.js?v=cc015130aa8521e7',
  pdfjs: 'vendor/pdf-6.1.200.min.mjs?v=4ba2f15599b03fde',
  pdfWorker: 'vendor/pdf.worker-6.1.200.min.mjs?v=2ab9e09667296dab',
  mammoth: 'vendor/mammoth.browser-1.12.0.min.js?v=5d4c0e7c9165d70b',
  jspdf: 'vendor/jspdf.umd-4.2.1.min.js?v=e6551fcdc32f09d6'
});
const MODULES = [
  'feat_mls_studygroups.js',
  'feat_mls_study_request.js',
  'feat_comp_report.js',
  'mls-outcome-study.js',
  'mls-opnote-pro.js',
  'mls-procedure-report.js',
  'feat_fullhistory_pdf.js',
  'feat_mls_outcome_pdf.js',
  'feat_after_visit_summary.js'
];

function parseArgs(argv) {
  const out = { runs: 3, headed: false, chrome: '', artifacts: '' };
  for (const arg of argv) {
    if (arg === '--headed') out.headed = true;
    else if (arg.startsWith('--runs=')) out.runs = Number(arg.slice(7));
    else if (arg.startsWith('--chrome=')) out.chrome = arg.slice(9);
    else if (arg.startsWith('--artifacts=')) out.artifacts = arg.slice(12);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(out.runs) || out.runs < 1 || out.runs > 20) throw new Error('--runs must be an integer from 1 through 20');
  return out;
}

function usage() {
  return [
    'Usage: node tests/live-local-adjunct-library-boundary.js [options]',
    '',
    '  --runs=N          Repeat in a fresh page context N times (default 3)',
    '  --headed          Show the isolated Chrome window',
    '  --chrome=PATH     Explicit Chrome/Chromium executable',
    `  --artifacts=PATH  Report destination (default ${DEFAULT_ARTIFACTS})`
  ].join('\n');
}

function findChrome(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/google-chrome',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/google-chrome-stable',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/chromium'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome was not found. Pass --chrome=PATH.');
  return found;
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })[ext] || 'application/octet-stream';
}

function harnessHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Synthetic local adjunct proof</title>
<link rel="icon" href="data:,">
</head><body>
<main>
  <div class="mlsctx-actions"><span class="mlsctx-switch"></span></div>
  <section id="studioView"><div id="mlsSgPro"></div></section>
  <section id="analysisView"></section>
  <section id="outcomeHarnessMount"></section>
</main>
</body></html>`;
}

function startServer(requestLog) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      requestLog.push({ method: req.method, path: url.pathname, search: url.search });
      if (url.pathname === '/__live-local-adjunct-library-boundary.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'"
        });
        res.end(harnessHtml());
        return;
      }
      const decoded = decodeURIComponent(url.pathname);
      const target = path.resolve(ROOT, `.${decoded}`);
      if (target === ROOT || !target.startsWith(`${ROOT}${path.sep}`)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const stat = fs.statSync(target);
      if (!stat.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'Content-Type': mimeType(target),
        'Content-Length': stat.size,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      });
      fs.createReadStream(target).pipe(res);
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function readTextWhenUnlocked(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return fs.readFileSync(file, 'utf8'); }
    catch (error) { lastError = error; await sleep(50); }
  }
  throw lastError || new Error(`Timed out reading ${file}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const handler of this.listeners.get(message.method) || []) handler(message.params || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chrome DevTools connection closed'));
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)), { once: true });
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) || [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  send(method, params = {}, timeoutMs = 70000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method}: Chrome DevTools response timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { try { this.socket.close(); } catch (_) {} }
}

async function launchChrome(chromePath, profileDir, headed) {
  const args = [
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-features=MediaRouter,OptimizationHints,Translate,AutofillServerCommunication',
    '--disable-sync',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    '--window-size=1280,900',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    'about:blank'
  ];
  if (!headed) args.unshift('--headless=new', '--hide-scrollbars');
  if (process.platform !== 'win32') args.unshift('--no-sandbox');
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !headed });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  try { await waitForFile(portFile, 15000); }
  catch (error) { try { child.kill(); } catch (_) {} throw new Error(`${error.message}\n${stderr.slice(-4000)}`); }
  const [port] = (await readTextWhenUnlocked(portFile, 5000)).trim().split(/\r?\n/);
  return { child, port: Number(port), stderr: () => stderr };
}

async function createPage(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chrome target creation failed: HTTP ${response.status}`);
  const target = await response.json();
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
  return cdp;
}

async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: !!options.awaitPromise,
    returnByValue: true,
    userGesture: options.userGesture !== false
  }, options.timeoutMs || 70000);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(detail || result.exceptionDetails.text || `Evaluation failed: ${expression.slice(0, 120)}`);
  }
  return result.result ? result.result.value : undefined;
}

async function waitFor(cdp, description, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, expression, { userGesture: false, timeoutMs: 5000 });
      if (last) return last;
    } catch (error) { last = error.message; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

function syntheticSetupExpression() {
  return `(() => {
    localStorage.clear(); sessionStorage.clear();
    const pad=n=>String(n).padStart(2,'0');
    const now=new Date();
    const visitDate=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(Math.max(1,Math.min(15,now.getDate())));
    const priorDate=(now.getFullYear()-1)+'-06-15';
    const rawOp=[
      'Patient: Synthetic Adjunct Patient',
      'DOB: 1980-01-02',
      'MRN: SYN-ADJ-0001',
      'Date of Procedure: '+visitDate,
      'Provider: Synthetic Clinician',
      '',
      'PREOPERATIVE DIAGNOSIS:',
      'Synthetic lumbar radiculopathy M54.16',
      '',
      'PROCEDURE(S) PERFORMED:',
      'Synthetic lumbar epidural injection CPT 62323',
      '',
      'ANESTHESIA:',
      'Local anesthetic documented in this synthetic fixture.',
      '',
      'DESCRIPTION OF PROCEDURE:',
      'Synthetic-only procedure narrative. No real patient facts.',
      '',
      'COMPLICATIONS:',
      'None documented in this synthetic fixture.',
      '',
      'DISPOSITION / POST-PROCEDURE PLAN:',
      'Synthetic follow-up instructions were reviewed.'
    ].join('\\n');
    const patient={
      id:'synthetic-patient-1', name:'Synthetic Adjunct Patient', dob:'1980-01-02', mrn:'SYN-ADJ-0001', sex:'Female',
      email:'synthetic.patient@mls.local', problems:'Synthetic lumbar radiculopathy', meds:['Synthetic medication entry'], allergies:['Synthetic allergy entry'],
      visits:[
        {id:'synthetic-visit-1',date:visitDate,type:'Procedure',detail:'Synthetic lumbar epidural injection CPT 62323. Pain 7/10 before procedure.',raw:rawOp,cpt:['62323','77003'],icd10:['M54.16'],setting:'Office',source:'synthetic-live'},
        {id:'synthetic-visit-2',date:priorDate,type:'Follow-up',detail:'Synthetic follow-up evidence. Pain 4/10.',raw:'Synthetic follow-up evidence only.',cpt:['99213'],icd10:['M54.16'],source:'synthetic-live'}
      ]
    };
    const note={id:'synthetic-note-1',patientId:patient.id,patient:patient.name,created:visitDate+'T12:00:00Z',updated:visitDate+'T12:00:00Z',cc:'Synthetic follow-up',text:'Synthetic visit note. Conservative plan and return precautions were reviewed. No real patient information.',plan:'Synthetic follow-up plan.'};
    window.__synthetic={patient,note,visitDate,priorDate,rawOp};
    window.getPatients=()=>[patient];
    window.getNotes=()=>[note];
    window.getActivePtId=()=>patient.id;
    window.activePatient=()=>patient;
    window.getName=()=> 'Synthetic Clinician';
    window.getSpec=()=> 'Synthetic PM&R';
    window.getKey=()=> 'synthetic-only-key';
    window.hasAI=()=> true;
    window.aiCallRaw=()=>Promise.resolve([
      'What we did today', 'We reviewed the synthetic visit.', '',
      'What we found', 'Only fictional findings are included.', '',
      'Your medications', 'No medication change was documented.', '',
      'Your instructions and next steps', 'Follow the synthetic plan reviewed today.', '',
      'Follow-up', 'Contact the clinic with questions.'
    ].join('\\n'));
    window.toast=(message,kind)=>{(window.__syntheticToasts||(window.__syntheticToasts=[])).push({message:String(message||''),kind:String(kind||'')});};
    window.bkUser={email:'synthetic.clinician@mls.local'};
    window.bkToken=()=> 'synthetic-only-token';
    window.bkBase=()=> location.origin;
    window.__syntheticApiCalls=[];
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin&&url.pathname==='/api/appointments'){
        window.__syntheticApiCalls.push({method:'GET',path:url.pathname});
        const from=url.searchParams.get('from')||visitDate;
        const day=from.slice(0,8)+'15';
        return Promise.resolve(new Response(JSON.stringify({doctors:[{id:'synthetic-doctor-1',name:'Synthetic Clinician'}],appointments:[
          {id:'synthetic-appt-1',doctor_user_id:'synthetic-doctor-1',provider_name:'Synthetic Clinician',appt_date:day,start_at:day+'T09:00:00-04:00',status:'completed',reason:'Synthetic morning visit'},
          {id:'synthetic-appt-2',doctor_user_id:'synthetic-doctor-1',provider_name:'Synthetic Clinician',appt_date:day,start_at:day+'T14:00:00-04:00',status:'completed',reason:'Synthetic afternoon visit'}
        ]}),{status:200,headers:{'Content-Type':'application/json'}}));
      }
      if(url.origin===location.origin&&url.pathname==='/api/payreport/fees'){
        window.__syntheticApiCalls.push({method:'GET',path:url.pathname});
        return Promise.resolve(new Response(JSON.stringify({ok:true,fees:[{code:'62323',description:'Synthetic lumbar epidural injection',medicareNonFacility:100,medicareFacility:80,expected:90,override:null}],bundles:{ESI_LUMBAR:['62323']},config:{}}),{status:200,headers:{'Content-Type':'application/json'}}));
      }
      return nativeFetch(input,init);
    };
    window.upsertPatient=()=>{};
    window.MLS_OPNOTE_LETTERHEAD={clinicName:'Synthetic Clinic',addressLines:['123 Fictional Avenue','Example, IN 46000']};
    window.pdfSafe=value=>String(value==null?'':value).replace(/[^\\x09\\x0A\\x0D\\x20-\\x7E]/g,'');
    window.__mlsVisitModel={
      getVisits:p=>(p&&p.visits||[]).slice(), deriveFromLegacy:()=>{},
      _svcToYMD:value=>{const m=String(value||'').match(/(\\d{4})-(\\d{2})-(\\d{2})/);return m?m[0]:'';}
    };
    window.__mlsRVU={
      _cf:()=>33.40,
      lookup:code=>({desc:code==='62323'?'Synthetic lumbar epidural injection':'Synthetic imaging guidance'}),
      wrvu:code=>code==='62323'?1.80:0.30,
      sumVisit:codes=>{const arr=Array.isArray(codes)?codes:[];const w=arr.reduce((n,c)=>n+(c==='62323'?1.80:(c==='77003'?0.30:0)),0);return {w,t:w,tDollars:w*33.40,hasT:true};}
    };
    window.loadJsPdf=()=>{
      if(window.jspdf&&window.jspdf.jsPDF)return Promise.resolve(window.jspdf);
      if(window.__syntheticJsPdfPromise)return window.__syntheticJsPdfPromise;
      window.__syntheticJsPdfPromise=new Promise((resolve,reject)=>{
        const s=document.createElement('script');s.src=${JSON.stringify(PINNED.jspdf)};s.dataset.syntheticSharedJspdf='1';
        s.onload=()=>resolve(window.jspdf);s.onerror=()=>reject(new Error('local jsPDF failed'));document.head.appendChild(s);
      });
      return window.__syntheticJsPdfPromise;
    };
    return {visitDate,patientId:patient.id};
  })()`;
}

function moduleLoaderExpression() {
  return `(async () => {
    const load=src=>new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src=src;s.dataset.syntheticModule=src;
      s.onload=()=>resolve(src);s.onerror=()=>reject(new Error('module load failed: '+src));document.head.appendChild(s);
    });
    for(const src of ${JSON.stringify(MODULES)}) await load(src);
    return {
      studyGroups:!!window.__mlsStudyGroups,
      studyRequest:!!window.__mlsStudyRequest,
      compReport:!!window.__mlsComp,
      outcomeStudy:!!window.__mlsOutcome,
      opNote:!!window.__mlsOpNotePro,
      procedure:!!window.__mlsProcReport,
      fullHistory:!!window.__mlsFullHistoryPdf,
      outcome:!!window.__mlsOutcomePdf,
      afterVisit:!!window.__mlsAfterVisitSummary
    };
  })()`;
}

function proofExpression() {
  return `(async () => {
    const need=(condition,message)=>{if(!condition)throw new Error(message);};
    const loadScript=src=>new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src=src;s.dataset.syntheticLibrary=src;
      s.onload=()=>resolve();s.onerror=()=>reject(new Error('library load failed: '+src));document.head.appendChild(s);
    });
    const waitUntil=async(predicate,message,timeout=20000)=>{
      const end=Date.now()+timeout;let last='';
      while(Date.now()<end){try{const value=predicate();if(value)return value;last=value;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,50));}
      throw new Error(message+'; last='+String(last));
    };
    const proof={versions:{},libraries:{},modules:{},exports:{pdfs:[],downloads:[]}};

    const groups=window.__mlsStudyGroups;
    const group=groups.createGroup('Synthetic adjunct cohort');
    const p1=groups.addPatient(group.id,{name:'Synthetic Adjunct Patient',dob:'1980-01-02',mrn:'SYN-ADJ-0001',visits:window.__synthetic.patient.visits});
    groups.addPatient(group.id,{name:'Synthetic Comparison Patient',dob:'1975-02-03',mrn:'SYN-ADJ-0002',visits:[
      {date:window.__synthetic.visitDate,type:'Follow-up',detail:'Synthetic comparison evidence. Pain 5/10.',source:'synthetic-live'}
    ]});
    need(p1&&group.id,'study group setup failed');
    const groupResult=await groups.runStudy(group.id,{maxPages:12});
    need(groupResult.xlsxBlob&&!groupResult.xlsxFallback,'study group fell back instead of building XLSX');
    need(groupResult.pdfBlob&&!groupResult.pdfError,'study group failed to build PDF: '+String(groupResult.pdfError||''));
    proof.versions.xlsx=String(window.XLSX&&window.XLSX.version||'');
    proof.versions.jspdf=String(window.jspdf&&window.jspdf.jsPDF&&window.jspdf.jsPDF.version||'');
    const workbookBytes=new Uint8Array(await groupResult.xlsxBlob.arrayBuffer());
    const workbook=window.XLSX.read(workbookBytes,{type:'array'});
    const visitRows=window.XLSX.utils.sheet_to_json(workbook.Sheets.Visits,{header:1});
    need(workbook.SheetNames.join(',')==='Summary,Visits','study workbook sheets drifted: '+workbook.SheetNames.join(','));
    need(visitRows.length>=4&&visitRows.some(row=>row[0]==='Synthetic Adjunct Patient'),'study workbook lost synthetic visit rows');
    proof.modules.studyGroups={patients:groupResult.analysis.patientCount,visits:groupResult.analysis.visitCount,xlsxBytes:workbookBytes.byteLength,sheets:workbook.SheetNames,pdfBytes:groupResult.pdfBlob.size,pdfPages:groupResult.pdfPages,svgBytes:groupResult.svg.length};

    const pdfjs=await import('/${PINNED.pdfjs}');
    pdfjs.GlobalWorkerOptions.workerSrc=new URL('/${PINNED.pdfWorker}',location.href).href;
    proof.versions.pdfjs=String(pdfjs.version||'');
    const inspectPdfBytes=async(value,label)=>{
      const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
      const size=bytes.byteLength;
      need(size>500,label+' PDF is unexpectedly small');
      const task=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false});
      const doc=await task.promise;let text='';
      for(let pageNo=1;pageNo<=doc.numPages;pageNo++){
        const page=await doc.getPage(pageNo);const content=await page.getTextContent();text+=' '+content.items.map(item=>item.str).join(' ');
      }
      const out={label,size,pages:doc.numPages,text:text.replace(/\\s+/g,' ').trim().slice(0,3000)};
      await task.destroy();return out;
    };
    const inspectPdfBlob=(blob,label)=>blob.arrayBuffer().then(buffer=>inspectPdfBytes(new Uint8Array(buffer),label));
    const groupPdf=await inspectPdfBlob(groupResult.pdfBlob,'study-groups');
    need(/MLS Study Group Report/i.test(groupPdf.text),'study group PDF lost its title');
    proof.exports.pdfs.push(groupPdf);

    const originalCreate=URL.createObjectURL.bind(URL);
    const originalRevoke=URL.revokeObjectURL.bind(URL);
    const blobUrls=new Map();
    const clicked=[];
    URL.createObjectURL=blob=>{const url=originalCreate(blob);blobUrls.set(url,blob);return url;};
    URL.revokeObjectURL=url=>{originalRevoke(url);};
    const nativeAnchorClick=HTMLAnchorElement.prototype.click;
    const nativeAnchorDispatch=HTMLAnchorElement.prototype.dispatchEvent;
    const captureAnchor=anchor=>{
      const blob=blobUrls.get(anchor.href);
      if(!blob)return false;
      clicked.push({filename:String(anchor.download||''),blob});
      return true;
    };
    HTMLAnchorElement.prototype.click=function(){
      if(captureAnchor(this))return;
      return nativeAnchorClick.call(this);
    };
    HTMLAnchorElement.prototype.dispatchEvent=function(event){
      if(event&&event.type==='click'&&captureAnchor(this))return true;
      return nativeAnchorDispatch.call(this,event);
    };
    const pdfCount=()=>clicked.filter(item=>/\.pdf$/i.test(item.filename)).length;

    window.__mlsComp.open();
    await waitUntil(()=>{const button=document.getElementById('mlsCompXlsx');return button&&!button.disabled;},'compensation report did not load synthetic appointments');
    let beforeDownloads=clicked.length;
    document.getElementById('mlsCompXlsx').click();
    await waitUntil(()=>clicked.length===beforeDownloads+1,'compensation XLSX was not exported');
    const compDownload=clicked[clicked.length-1];
    need(/^MLS_Pay_Report_.*\.xlsx$/i.test(compDownload.filename),'compensation workbook filename drifted: '+compDownload.filename);
    const compWorkbook=window.XLSX.read(new Uint8Array(await compDownload.blob.arrayBuffer()),{type:'array'});
    need(compWorkbook.SheetNames.includes('Reconciliation')&&compWorkbook.SheetNames.includes('Synthetic Clinician'),'compensation workbook lost reconciliation/provider sheets');
    proof.modules.compReport={xlsxBytes:compDownload.blob.size,sheets:compWorkbook.SheetNames,apiCalls:(window.__syntheticApiCalls||[]).slice()};
    window.__mlsComp.close();

    window.__mlsOutcome.open();
    await waitUntil(()=>document.getElementById('ocDemo'),'outcome-study modal did not open');
    document.getElementById('ocDemo').click();
    await waitUntil(()=>document.getElementById('ocRunDemo'),'outcome-study demo did not reach the build step');
    document.getElementById('ocRunDemo').click();
    await waitUntil(()=>document.getElementById('ocExpXlsx'),'outcome-study results did not render');
    beforeDownloads=clicked.length;
    document.getElementById('ocExpXlsx').click();
    await waitUntil(()=>clicked.length===beforeDownloads+1,'outcome-study XLSX was not exported');
    const outcomeWorkbookDownload=clicked[clicked.length-1];
    need(/^outcome_study_.*\.xlsx$/i.test(outcomeWorkbookDownload.filename),'outcome workbook filename drifted: '+outcomeWorkbookDownload.filename);
    const outcomeWorkbook=window.XLSX.read(new Uint8Array(await outcomeWorkbookDownload.blob.arrayBuffer()),{type:'array'});
    need(outcomeWorkbook.SheetNames.join(',')==='Summary,Per-patient','outcome workbook sheets drifted: '+outcomeWorkbook.SheetNames.join(','));
    proof.modules.outcomeStudy={xlsxBytes:outcomeWorkbookDownload.blob.size,sheets:outcomeWorkbook.SheetNames};

    const records=window.__mlsStudyRequest.collectStoredRecords({
      getPatients:window.getPatients,getNotes:window.getNotes,_calAppts:[],sgFix:{buildAll:()=>[]},__mlsCodeTable:null
    });
    const spec=window.__mlsStudyRequest.parseStudySpec('Study outcomes for all stored patients, all time');
    need(spec&&spec.ok,'natural-language study request did not parse');
    const studyRequest=await window.__mlsStudyRequest.executeSpec(spec,{
      sg:groups,records,document,now:new Date(),jsPDF:window.jspdf.jsPDF,useAi:false
    });
    need(studyRequest.pdfBlob&&!studyRequest.pdfError,'natural-language study request failed to build PDF: '+String(studyRequest.pdfError||''));
    need(studyRequest.xlsxBlob&&studyRequest.xlsxFallback,'limited-data CSV boundary drifted');
    const limitedText=JSON.stringify(studyRequest.limitedDataPatients);
    need(!limitedText.includes('Synthetic Adjunct Patient')&&!limitedText.includes('SYN-ADJ-0001'),'study request retained a direct identifier');
    const limitedCsv=await studyRequest.xlsxBlob.text();
    need(/P001/.test(limitedCsv)&&!/Synthetic Adjunct Patient|SYN-ADJ-0001/.test(limitedCsv),'limited-data CSV was not deidentified');
    const requestPdf=await inspectPdfBlob(studyRequest.pdfBlob,'study-request');
    need(/Limited-data|study draft|Abstract/i.test(requestPdf.text),'study request PDF lost its privacy/report text');
    proof.modules.studyRequest={patients:studyRequest.scoped.patientCount,visits:studyRequest.scoped.visitCount,pdfPages:studyRequest.pdfPages,csvBytes:studyRequest.xlsxBlob.size,directIdentifiersAbsent:true};
    proof.exports.pdfs.push(requestPdf);

    const opNormalized=window.__mlsOpNotePro.normalize(window.__synthetic.rawOp,{patient:window.__synthetic.patient.name,dob:window.__synthetic.patient.dob,mrn:window.__synthetic.patient.mrn,dop:window.__synthetic.visitDate,provider:'Synthetic Clinician',spec:'Synthetic PM&R'});
    need(window.__mlsOpNotePro.isNormalized(opNormalized),'op-note normalization failed');
    let before=pdfCount();
    const opSaved=await window.__mlsOpNotePro.exportPdf(window.__synthetic.rawOp,{patient:window.__synthetic.patient.name});
    need(opSaved===true,'op-note export returned failure');
    await waitUntil(()=>pdfCount()===before+1,'op-note PDF was not saved');
    proof.modules.opNote={normalized:true};

    before=pdfCount();
    const historySaved=await window.__mlsFullHistoryPdf.build(window.__synthetic.patient);
    need(historySaved===true,'full-history export returned failure');
    await waitUntil(()=>pdfCount()===before+1,'full-history PDF was not saved');
    proof.modules.fullHistory={saved:true,visits:window.__synthetic.patient.visits.length};

    const proc=window.__mlsProcReport;
    Object.assign(proc._state(),{presetKey:'custom',customFrom:window.__synthetic.visitDate,customTo:window.__synthetic.visitDate,range:{from:window.__synthetic.visitDate,to:window.__synthetic.visitDate,label:'Synthetic day'}});
    const aggregate=proc.aggregate(proc._state().range);
    need(aggregate.total===1&&aggregate.totalW>0,'procedure aggregation did not use the synthetic CPT visit');
    beforeDownloads=clicked.length;
    proc.exportCSV();
    await waitUntil(()=>clicked.length===beforeDownloads+1,'procedure CSV was not exported');
    const procedureCsvBlob=clicked[clicked.length-1].blob;
    const procedureCsv=await procedureCsvBlob.text();
    need(/62323/.test(procedureCsv)&&/Total procedures/.test(procedureCsv),'procedure CSV lost aggregate evidence');
    before=pdfCount();
    proc.exportPDF();
    await waitUntil(()=>pdfCount()===before+1,'procedure PDF was not saved');
    proof.modules.procedureReport={total:aggregate.total,totalW:aggregate.totalW,csvBytes:procedureCsvBlob.size};

    before=pdfCount();
    window.__mlsOutcomePdf.buildPdf();
    await waitUntil(()=>pdfCount()===before+1,'outcome-study PDF was not saved',30000);
    beforeDownloads=clicked.length;
    window.__mlsOutcomePdf.exportSVG();
    await waitUntil(()=>clicked.length===beforeDownloads+1,'outcome-study SVG was not exported');
    const svgText=await clicked[clicked.length-1].blob.text();
    need(/<svg/i.test(svgText)&&/polyline/.test(svgText),'outcome SVG export is invalid');
    proof.modules.outcomeReport={svgBytes:clicked[clicked.length-1].blob.size};

    window.__mlsAfterVisitSummary.open();
    need(document.getElementById('mlsavsGen'),'after-visit modal did not open');
    document.getElementById('mlsavsGen').click();
    await waitUntil(()=>/What we did today/.test((document.getElementById('mlsavsText')||{}).value||''),'after-visit summary did not generate');
    before=pdfCount();
    document.getElementById('mlsavsPdf').click();
    await waitUntil(()=>pdfCount()===before+1,'after-visit PDF was not saved');
    need(document.getElementById('mlsavsCopyEmail')&&!document.getElementById('mlsavsSend'),'after-visit summary must expose a local email-draft copy action and no sender');
    proof.modules.afterVisit={generated:true,emailDraftOnly:true,sent:false};

    for(const item of clicked.filter(item=>/\.pdf$/i.test(item.filename))){
      const parsed=await inspectPdfBlob(item.blob,item.filename);
      proof.exports.pdfs.push(parsed);
    }
    const byName=name=>proof.exports.pdfs.find(item=>item.label.includes(name));
    need(byName('OpNote_')&&/OPERATIVE|PROCEDURE NOTE/i.test(byName('OpNote_').text),'op-note PDF text is missing');
    need(byName('VisitHistory_')&&/COMPLETE VISIT HISTORY/i.test(byName('VisitHistory_').text),'full-history PDF text is missing');
    need(byName('ProcedureReport_')&&/PROCEDURE REPORT/i.test(byName('ProcedureReport_').text),'procedure report PDF text is missing');
    need(byName('outcome_study_report_')&&/MLS Outcome Study/i.test(byName('outcome_study_report_').text),'outcome report PDF text is missing');
    need(byName('After-Visit-Summary')&&/After-Visit Summary/i.test(byName('After-Visit-Summary').text),'after-visit PDF text is missing');

    for(const item of clicked){
      proof.exports.downloads.push({filename:item.filename,size:item.blob.size,type:item.blob.type});
    }

    await loadScript('/${PINNED.chart}');
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=180;document.body.appendChild(canvas);
    const chart=new window.Chart(canvas.getContext('2d'),{type:'bar',data:{labels:['Synthetic A','Synthetic B'],datasets:[{label:'Synthetic only',data:[2,5]}]},options:{responsive:false,animation:false}});
    chart.update();
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let opaque=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])opaque++;
    proof.versions.chart=String(window.Chart.version||'');
    proof.libraries.chart={opaquePixels:opaque};
    chart.destroy();canvas.remove();
    need(opaque>1000,'Chart.js did not render visible pixels');

    await loadScript('/${PINNED.mammoth}');
    const fixture=await fetch('/tests/fixtures/vendor-boundary-single-paragraph.docx',{cache:'no-store'});
    need(fixture.ok,'Mammoth DOCX fixture failed to load');
    const mammothResult=await window.mammoth.extractRawText({arrayBuffer:await fixture.arrayBuffer()});
    const mammothText=String(mammothResult&&mammothResult.value||'').trim();
    need(mammothText.length>0,'Mammoth returned empty DOCX text');
    proof.libraries.mammoth={text:mammothText.slice(0,500),messages:(mammothResult.messages||[]).length};

    proof.libraries.pdfjs={workerSrc:pdfjs.GlobalWorkerOptions.workerSrc,isEvalSupported:false};
    proof.libraries.xlsx={workbookBytes:workbookBytes.byteLength,sheets:workbook.SheetNames};
    proof.libraries.jspdf={capturedPdfCount:pdfCount()};
    proof.browserErrors=(window.__syntheticBrowserErrors||[]).slice();
    proof.toasts=(window.__syntheticToasts||[]).slice(-30);
    return proof;
  })()`;
}

/* CLEANUP MUST NOT BE ABLE TO FAIL A RUN THAT PASSED.
   Chrome keeps writing into its profile directory for a short while AFTER the
   process is told to exit - leveldb compaction, cache flushes - so rmSync can
   race it and throw ENOTEMPTY on .../Default. MEASURED here: the suite printed
     PASS: 3/3 isolated cycles, 21 real PDFs parsed, 9 workbooks verified,
           69 local GETs, 0 external requests
   and then exited NON-ZERO on this line, so a completely successful run reads
   as a failing suite. That is the same shape as the two harnesses fixed in
   b812: an instrument that cannot report its own success is not reporting.

   `force: true` does not help - it suppresses "missing", not "not empty". So
   the removal retries briefly to let Chrome finish, and if the directory still
   will not go it says so and CARRIES ON. A leftover directory in the OS temp
   folder is not a test result; the assertions above it are.

   The path guard is unchanged and still throws: refusing to delete an
   unexpected path is a real safety rule, not a cleanup convenience. */
function safeRemoveProfile(profileDir) {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(profileDir);
  if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith('mls-live-adjunct-profile-')) {
    throw new Error(`Refusing to remove unexpected Chrome profile path: ${resolved}`);
  }
  const deadline = Date.now() + 5000;
  for (;;) {
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); return; }
    catch (error) {
      if (Date.now() >= deadline) {
        process.stdout.write(`[live-local-libraries] note: could not remove the Chrome profile at ${resolved} `
          + `(${error && error.code || error}). Chrome was still writing to it. The run's assertions are unaffected.\n`);
        return;
      }
      const wait = Date.now() + 250;
      while (Date.now() < wait) { /* deliberately synchronous: this runs in teardown, off the event loop */ }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${usage()}\n`); return; }
  const chromePath = findChrome(args.chrome);
  const artifactDir = path.resolve(ROOT, args.artifacts || DEFAULT_ARTIFACTS);
  fs.mkdirSync(artifactDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-live-adjunct-profile-'));
  const requestLog = [];
  const { server, origin } = await startServer(requestLog);
  const browserDiagnostics = { console: [], exceptions: [] };
  const externalRequests = [];
  let chrome;
  let cdp;
  let report;
  const progress = (message) => process.stdout.write(`[live-local-libraries] ${message}\n`);
  try {
    progress('launching isolated Chrome and no-store loopback server');
    chrome = await launchChrome(chromePath, profileDir, args.headed);
    cdp = await createPage(chrome.port, 'about:blank');
    cdp.on('Runtime.consoleAPICalled', (event) => {
      const text = (event.args || []).map((arg) => String(arg.value != null ? arg.value : (arg.description || arg.type || ''))).join(' ');
      browserDiagnostics.console.push({ type: event.type, text: text.slice(0, 2000) });
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      const detail = event.exceptionDetails || {};
      browserDiagnostics.exceptions.push({ text: detail.text || '', description: detail.exception && detail.exception.description || '', url: detail.url || '', lineNumber: detail.lineNumber });
    });
    cdp.on('Network.requestWillBeSent', (event) => {
      try {
        const url = new URL(event.request.url);
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') {
          externalRequests.push({ url: url.href, method: event.request.method, type: event.type });
        }
      } catch (_) {}
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__syntheticBrowserErrors=[];
      addEventListener('error',event=>window.__syntheticBrowserErrors.push({type:'error',message:String(event.message||''),source:String(event.filename||''),line:event.lineno||0}));
      addEventListener('unhandledrejection',event=>window.__syntheticBrowserErrors.push({type:'unhandledrejection',message:String(event.reason&&event.reason.stack||event.reason||'')}));
    })();` });
    const cycles = [];
    let modules;
    let proof;
    for (let run = 1; run <= args.runs; run++) {
      await cdp.send('Page.navigate', { url: `${origin}/__live-local-adjunct-library-boundary.html?run=${run}` });
      await waitFor(cdp, `synthetic harness document for run ${run}`, `document.readyState==='complete' && !!document.getElementById('analysisView')`, 20000);
      const setup = await evaluate(cdp, syntheticSetupExpression());
      progress(`run ${run}/${args.runs}: synthetic fixture ready for ${setup.visitDate}`);
      modules = await evaluate(cdp, moduleLoaderExpression(), { awaitPromise: true, timeoutMs: 50000 });
      assert(Object.values(modules).every(Boolean), `run ${run}: not every adjunct module loaded: ${JSON.stringify(modules)}`);
      proof = await evaluate(cdp, proofExpression(), { awaitPromise: true, timeoutMs: 120000 });
      assert.strictEqual(proof.versions.chart, '4.5.1', `run ${run}: Chart.js version drift: ${proof.versions.chart}`);
      assert.strictEqual(proof.versions.xlsx, '0.20.3', `run ${run}: SheetJS version drift: ${proof.versions.xlsx}`);
      assert.strictEqual(proof.versions.jspdf, '4.2.1', `run ${run}: jsPDF version drift: ${proof.versions.jspdf}`);
      assert.strictEqual(proof.versions.pdfjs, '6.1.200', `run ${run}: PDF.js version drift: ${proof.versions.pdfjs}`);
      assert.strictEqual(proof.exports.pdfs.length, 7, `run ${run}: expected seven parsed PDF paths: ${JSON.stringify(proof.exports.pdfs.map((item) => item.label))}`);
      assert(proof.exports.pdfs.every((item) => item.size > 500 && item.pages >= 1 && item.text.length > 0), `run ${run}: one or more PDF exports were empty or not text-readable`);
      assert.strictEqual(proof.modules.afterVisit.sent, false, `run ${run}: after-visit proof sent data instead of stopping at review/export`);
      assert.deepStrictEqual(proof.browserErrors, [], `run ${run}: browser error event occurred: ${JSON.stringify(proof.browserErrors)}`);
      cycles.push({ run, setup, modules, proof });
      progress(`run ${run}/${args.runs}: 7 PDFs, 3 XLSX workbooks, CSV/SVG/DOCX/Chart passed`);
    }

    assert.deepStrictEqual(browserDiagnostics.exceptions, [], `uncaught Chrome exception occurred: ${JSON.stringify(browserDiagnostics.exceptions)}`);
    assert.deepStrictEqual(externalRequests, [], `an adjunct attempted an external request: ${JSON.stringify(externalRequests)}`);

    const requested = new Set(requestLog.map((entry) => entry.path + entry.search));
    for (const rel of Object.values(PINNED)) {
      assert(requested.has('/' + rel), `pinned runtime asset was not fetched from the loopback origin: ${rel}`);
    }
    for (const moduleName of MODULES) assert(requested.has('/' + moduleName), `production adjunct was not fetched: ${moduleName}`);
    assert(requested.has('/tests/fixtures/vendor-boundary-single-paragraph.docx'), 'Mammoth fixture was not fetched locally');
    assert(requestLog.every((entry) => entry.method === 'GET'), `live proof made a non-GET request: ${JSON.stringify(requestLog)}`);

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 20000);
    fs.writeFileSync(path.join(artifactDir, 'harness.png'), Buffer.from(screenshot.data, 'base64'));
    report = {
      status: 'PASS',
      generatedAt: new Date().toISOString(),
      syntheticOnly: true,
      origin,
      chromePath,
      chromeUserAgent: await evaluate(cdp, 'navigator.userAgent', { userGesture: false }),
      runs: args.runs,
      cycles,
      pinned: PINNED,
      modules,
      proof,
      requestLog,
      externalRequests,
      browserDiagnostics
    };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    progress(`PASS: ${args.runs}/${args.runs} isolated cycles, ${proof.exports.pdfs.length * args.runs} real PDFs parsed, ${3 * args.runs} workbooks verified, ${requestLog.length} local GETs, 0 external requests`);
  } catch (error) {
    report = {
      status: 'FAIL', generatedAt: new Date().toISOString(), syntheticOnly: true,
      error: error.stack || String(error), requestLog, externalRequests, browserDiagnostics,
      chromeStderr: chrome ? chrome.stderr().slice(-8000) : ''
    };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    throw error;
  } finally {
    if (cdp) cdp.close();
    if (chrome && chrome.child) {
      try { chrome.child.kill(); } catch (_) {}
      await Promise.race([new Promise((resolve) => chrome.child.once('exit', resolve)), sleep(3000)]);
    }
    await new Promise((resolve) => server.close(resolve));
    safeRemoveProfile(profileDir);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
