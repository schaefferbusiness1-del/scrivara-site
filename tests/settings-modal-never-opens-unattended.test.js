'use strict';

/* THE FULL SETTINGS DIALOG OPENED BY ITSELF DURING A DAY PULL (owner, b1233).
 *
 * MEASURED: #settingsModal.show has exactly ONE writer in the shell -
 * openSettings() - and openSettings() was called from four GENERATION REFUSAL
 * branches: ai-unavailable in generateNote(), the coding review, the
 * recommendations lane, and the unresolved-signer refusal in signNote().
 * generateNote() is invoked PROGRAMMATICALLY by the kiosk avatar timer
 * (1p-feat_mls_avatar.js), the recording-segment lane
 * (feat_mls_recording_segments.js), the voice-intent router (1p-mls-connect.js)
 * and the command palette (feat_mls_command_palette.js). A transient hasAI()
 * false while a day pull saturated the network therefore threw the whole
 * Settings dialog over work nobody had asked to interrupt.
 *
 * This suite runs the REAL gate and the REAL openSettings out of both shells in
 * a vm, with a recording stand-in for #settingsModal.classList that logs every
 * 'show' addition the way a MutationObserver would, and it runs the REAL
 * generateNote() with hasAI() forced false. The contract:
 *   - a refusal reached with no gesture adds 'show' ZERO times
 *   - a stale gesture (older than the window) adds 'show' ZERO times
 *   - the refusal code and the return value are unchanged
 *   - the refusal still offers an inline "Open Settings" control
 *   - POSITIVE CONTROL: a trusted pointerdown followed by the header button's
 *     own openSettings() DOES open it, and openSettings({userInitiated:true})
 *     opens it with no gesture at all - which is what the first-run Configure
 *     path needs, because it runs after an await and still has to land on
 *     Notes & AI.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }

const GATE_START = '/* settingsgate-1.0.0 (owner P0 2026-09-11)';
const GATE_END = '\n  return true;\n}\n';

function gateBlock(source, file) {
  const start = source.indexOf(GATE_START);
  assert.ok(start > 0, file + ': the settings gate is gone');
  const end = source.indexOf(GATE_END, start);
  assert.ok(end > start, file + ': openSettings no longer ends with the gate return');
  return source.slice(start, end + GATE_END.length);
}
function generationBlock(source, file) {
  const start = source.indexOf('async function generateNote()');
  const end = source.indexOf('\n/* =========================================================\n   AUTO-POPULATE EXTRAS', start);
  assert.ok(start > 0 && end > start, file + ': generateNote block missing');
  return source.slice(start, end);
}
/* "does this code still call openSettings?" must not be answered by a COMMENT
   that names it - strip block comments before asking. */
function codeOnly(source) { return String(source).replace(/\/\*[\s\S]*?\*\//g, ' '); }
function between(source, from, to, label, file) {
  const start = source.indexOf(from);
  assert.ok(start > 0, file + ': ' + label + ' start marker missing');
  const end = source.indexOf(to, start);
  assert.ok(end > start, file + ': ' + label + ' end marker missing');
  return source.slice(start, end);
}

/* ---- a DOM small enough to read, honest about the one thing under test ---- */
function makeDom(shows) {
  const nodes = Object.create(null);
  const listeners = [];
  function element(id) {
    const el = {
      id: id || '', value: '', checked: false, className: '', textContent: '', innerHTML: '',
      disabled: false, type: '', hidden: false, children: [], parentNode: null, nextSibling: null,
      style: { cssText: '', display: '' }, _attrs: Object.create(null), _clicks: [],
      classList: {
        add(name) { if (id === 'settingsModal' && name === 'show') shows.push(name); },
        remove() {}, toggle() {}, contains() { return false; }
      },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
      hasAttribute(k) { return k in this._attrs; },
      removeAttribute(k) { delete this._attrs[k]; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener(type, fn) { if (type === 'click') this._clicks.push(fn); },
      removeEventListener() {},
      appendChild(child) { return this.insertBefore(child); },
      insertBefore(child) {
        child.parentNode = this; this.children.push(child);
        if (child.id) nodes[child.id] = child;
        return child;
      },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        child.parentNode = null;
        if (child.id && nodes[child.id] === child) delete nodes[child.id];
        return child;
      },
      scrollIntoView() {}, focus() {},
      click() { this._clicks.slice().forEach(function (fn) { fn({ isTrusted: false }); }); }
    };
    return el;
  }
  const body = element('body');
  const document = {
    body,
    getElementById(id) { return id in nodes ? nodes[id] : null; },
    createElement() { return element(''); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn, capture) { listeners.push({ type: type, fn: fn, capture: capture === true }); },
    removeEventListener() {}
  };
  function mount(id) { const el = element(id); nodes[id] = el; body.appendChild(el); return el; }
  return { document: document, mount: mount, listeners: listeners, nodes: nodes };
}

/* every global the REAL openSettings dereferences without a guard, and no more */
function makeSandbox(dom, clock, refusals) {
  const RealDate = Date;
  function FakeDate(a, b, c) { return arguments.length ? new RealDate(a, b, c) : new RealDate(); }
  FakeDate.now = function () { return clock.now; };
  const transcriptEl = dom.nodes.transcript;
  return {
    document: dom.document,
    window: {},
    Date: FakeDate,
    localStorage: { getItem() { return null; }, setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    FEATURE_DEFAULTS: {},
    snapshotQolCommits() {}, applyBackendModeUI() {}, applyNavLayout() {},
    renderDocPrefs() {}, renderTwofaSettings() {}, renderPullVisitBodiesSetting() {},
    mlsBuildSettingsTabs() {}, renderNavFeatToggles() {},
    getKey: () => '', getName: () => '', getSpec: () => '', getIdleMins: () => 0,
    getDefaultComment: () => '', getQolTheme: () => 'light', getQolTextSize: () => 'm',
    getQolCompact: () => false, getQolConfirmLogout: () => false, getQolPtLayout: () => 'grid',
    getQolGroupProc: () => false, getAutoSendEMR: () => false, getQolSignature: () => '',
    getQolFollowup: () => '', useTemplatesOn: () => false, getPracticeName: () => '',
    getProviderName: () => '', getProviderCred: () => '', getNpi: () => '',
    getClinicAddress: () => '', getClinicPhone: () => '', getDefaultFormat: () => 'soap',
    getGenStyle: () => 'soap', getAutoDraftPrior: () => false, getNoteModel: () => '',
    getMlsNoteStyle: () => '', effectivePremium: () => true, backendMode: () => false,
    bkToken: () => '', bkUser: null, uns: (k) => k, featOn: () => false,
    /* generateNote's early refusal path */
    EXAMPLE: 'A different synthetic example transcript.',
    hasAI: () => false,
    _mlsGenerationEvidenceDecision: () => ({ ok: true }),
    _mlsExactScheduledClinicalAction: () => true,
    _athenaGuardBoundEditor: () => true,
    _mlsRefuseGeneration(code, message) { refusals.push({ code: String(code), message: String(message) }); return false; },
    _mlsStartGeneration: () => ({ id: 1, controller: { signal: null }, abortReason: '' }),
    toast() {},
    __transcriptEl: transcriptEl
  };
}

(async function () {
  const gates = [];
  for (const file of shells) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');

    /* ---- 1. the shell still has exactly one writer of settingsModal.show --- */
    const writers = source.split("getElementById('settingsModal').classList.add('show')").length - 1;
    eq(writers, 1, file + ': settingsModal.show no longer has exactly one writer');
    ok(/function openSettings\(opts\)\{/.test(source), file + ': openSettings does not take an options argument');
    ok(source.includes("if(!(opts&&opts.userInitiated===true)&&!__mlsSettingsGestureFresh()) return false;"),
      file + ': the gesture gate is missing from openSettings');
    ok(source.includes("document.addEventListener('pointerdown',__mlsStampTrustedGesture,true);")
      && source.includes("document.addEventListener('keydown',__mlsStampTrustedGesture,true);"),
      file + ': the capture-phase trusted-gesture listeners are missing');
    ok(source.includes('if(ev&&ev.isTrusted===true) __mlsLastTrustedGesture=Date.now();'),
      file + ': the gesture stamp no longer requires a TRUSTED event');

    /* the gate must be the FIRST statement of openSettings - a refusal that ran
       after the draft-tuning loader or the backend-mode repaint would already
       have had side effects on the doctor's screen */
    const bodyStart = source.indexOf('function openSettings(opts){');
    const guardAt = source.indexOf('if(!(opts&&opts.userInitiated===true)', bodyStart);
    const firstWork = source.indexOf('window.__mlsEnsureDraftTuning()', bodyStart);
    ok(guardAt > bodyStart && firstWork > guardAt, file + ': the gate is not the first statement of openSettings');

    /* ---- 2. the four refusal branches offer the door, never force it ------- */
    const gen = generationBlock(source, file);
    ok(!/\bopenSettings\(/.test(codeOnly(gen)), file + ': generateNote still calls openSettings');
    ok(gen.includes("_mlsOfferSettingsAction(_mlsAiKeyMessage,['noteGenError','genError','genBtn']);"),
      file + ': the ai-unavailable refusal lost its inline Open Settings control');
    ok(gen.includes("_mlsRefuseGeneration('ai-unavailable',_mlsAiKeyMessage)"),
      file + ': the ai-unavailable refusal code changed');

    const coding = between(source, 'async function reviewCodingDocumentation()', '\nasync function generateRecommendations()', 'coding review', file);
    ok(!/\bopenSettings\(/.test(codeOnly(coding)), file + ': the coding review still calls openSettings');
    ok(coding.includes("_mlsOfferSettingsAction('Add your OpenAI API key in Settings to optimize coding.',['optBtn']);"),
      file + ': the coding-review refusal lost its inline Open Settings control');

    const recs = between(source, 'async function generateRecommendations()', '\nfunction recommendationsText()', 'recommendations', file);
    ok(!/\bopenSettings\(/.test(codeOnly(recs)), file + ': the recommendations lane still calls openSettings');
    ok(recs.includes("_mlsOfferSettingsAction('Add your OpenAI API key in Settings to generate recommendations.',['genRecsBtn']);"),
      file + ': the recommendations refusal lost its inline Open Settings control');

    const signerAt = source.indexOf('MLS cannot confirm who is signing this note.');
    const signerSlice = source.slice(signerAt, signerAt + 700);
    ok(!/\bopenSettings\(/.test(codeOnly(signerSlice)), file + ': the unresolved-signer refusal still calls openSettings');
    ok(signerSlice.includes("_mlsOfferSettingsAction('MLS cannot confirm who is signing this note."),
      file + ': the unresolved-signer refusal lost its inline Open Settings control');

    /* the header control keeps working THROUGH the gesture stamp - it must not
       have been "fixed" by handing it the flag, which would reopen the hole */
    ok(source.includes('<button class="btn-white" onclick="openSettings()">Settings</button>'),
      file + ': the header Settings button changed shape');

    /* ---- 3. run the real gate, the real openSettings, the real generateNote - */
    const gate = gateBlock(source, file);
    gates.push(gate);

    const shows = [];
    const refusals = [];
    const dom = makeDom(shows);
    ['settingsModal', 'apiKey', 'docName', 'docSpec', 'keyOk', 'noteGenError', 'genBtn', 'transcript'].forEach(dom.mount);
    dom.nodes.transcript.value = 'Synthetic visit transcript that is not the example.';
    const clock = { now: 5000000 };
    const sandbox = makeSandbox(dom, clock, refusals);
    vm.createContext(sandbox);
    vm.runInContext(
      "var currentVisitAthenaBinding=null,currentVisitAthenaEpoch=0,currentFormat='soap',currentOpt=null,currentSoap='',currentNoteProvenance='',currentAthenaNote='',_mlsActiveGeneration=null;\n"
      + gate + '\n' + generationBlock(source, file)
      + '\nthis.__openSettings=openSettings;this.__generate=generateNote;this.__fresh=__mlsSettingsGestureFresh;',
      sandbox, { filename: file + ':settings-gate' });

    const stampers = dom.listeners.filter((l) => l.capture && (l.type === 'pointerdown' || l.type === 'keydown'));
    eq(stampers.length, 2, file + ': the gate did not install both capture-phase gesture listeners');

    /* an UNTRUSTED event - which is all a synthetic driver or an injected
       script can produce - must not count as a gesture */
    stampers.forEach((l) => l.fn({ isTrusted: false }));
    eq(sandbox.__openSettings(), false, file + ': an untrusted event opened Settings');
    eq(shows.length, 0, file + ': an untrusted event added show');

    /* THE DEFECT: a background generateNote() with no AI configured */
    eq(await sandbox.__generate(), false, file + ': the ai-unavailable refusal changed its return value');
    eq(refusals.length, 1, file + ': the ai-unavailable refusal did not settle exactly once');
    eq(refusals[0].code, 'ai-unavailable', file + ': the ai-unavailable refusal code changed');
    eq(refusals[0].message, 'Add your OpenAI API key in Settings to generate notes.', file + ': the refusal sentence changed');
    eq(shows.length, 0, file + ': an unattended generateNote() opened the Settings dialog');

    /* but it DID leave a door the doctor can press */
    const offer = dom.nodes.mlsSettingsOfferRow;
    ok(offer, file + ': the refusal left no inline Open Settings control');
    const offerBtn = dom.nodes.mlsSettingsOfferBtn;
    ok(offerBtn && offerBtn.textContent === 'Open Settings', file + ': the inline control is not an Open Settings button');
    offerBtn.click();
    eq(shows.length, 1, file + ': the doctor\'s own click on the inline control did not open Settings');
    ok(!dom.nodes.mlsSettingsOfferRow, file + ': the inline control survived its own press');

    /* a STALE gesture must not carry a later background call */
    stampers[0].fn({ isTrusted: true });
    ok(sandbox.__fresh(), file + ': a trusted event did not stamp the gesture');
    clock.now += 1500;
    eq(sandbox.__fresh(), false, file + ': the gesture window never expires');
    eq(sandbox.__openSettings(), false, file + ': a stale gesture opened Settings');
    eq(shows.length, 1, file + ': a stale gesture added show');
    refusals.length = 0;
    eq(await sandbox.__generate(), false, file + ': the second refusal changed its return value');
    eq(shows.length, 1, file + ': a second unattended refusal opened the Settings dialog');

    /* POSITIVE CONTROL 1: the header button - trusted pointerdown, then the
       inline onclick, exactly as the browser sequences them */
    stampers[0].fn({ isTrusted: true });
    eq(sandbox.__openSettings(), true, file + ': a trusted click on the header Settings button did not open Settings');
    eq(shows.length, 2, file + ': a trusted header click did not add show');

    /* POSITIVE CONTROL 2: the first-run Configure path - no gesture in the
       window at all, because it ran behind an await */
    clock.now += 60000;
    eq(sandbox.__fresh(), false, file + ': the gesture window never expires');
    eq(sandbox.__openSettings({ userInitiated: true }), true, file + ': an explicit userInitiated caller was refused');
    eq(shows.length, 3, file + ': an explicit userInitiated caller did not open Settings');
  }

  /* ---- 4. both shells carry the SAME gate, byte for byte ------------------ */
  eq(gates[0], gates[1], 'the two shells carry different settings gates');

  /* ---- 5. the audited late callers pass the flag -------------------------- */
  const firstrun = fs.readFileSync(path.join(root, 'feat_mls_firstrun.js'), 'utf8');
  const onAi = between(firstrun, 'async function onAiClick()', '\n  function onPullClick()', 'onAiClick', 'feat_mls_firstrun.js');
  ok(onAi.includes('await window.__mlsEnsureDraftTuning()'), 'feat_mls_firstrun.js: Configure no longer awaits the loader');
  ok(onAi.includes('window.openSettings({ userInitiated: true })'),
    'feat_mls_firstrun.js: Configure runs after an await and no longer passes userInitiated');
  const openAt = onAi.indexOf('window.openSettings({ userInitiated: true })');
  const focusAt = onAi.indexOf('focusAiFormats(0)');
  ok(openAt > 0 && focusAt > openAt, 'feat_mls_firstrun.js: Configure no longer lands on the AI formats section after opening Settings');
  /* focusAiFormats only resolves once the modal actually carries .show, so a
     refused open would have turned Configure into a visible failure - this is
     the reason that call site needs the flag */
  ok(firstrun.includes("modal.classList.contains('show')"), 'feat_mls_firstrun.js: Configure no longer waits for the open modal');

  console.log('settings-modal-never-opens-unattended: ' + checks + ' checks passed');
})().catch((error) => { console.error(error && error.stack || error); process.exit(1); });
