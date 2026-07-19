'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_exact_encounter_verify.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const stagingConnect = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const liveHtml = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const stagingHtml = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const pagesConfig = fs.readFileSync(path.join(root, '_config.yml'), 'utf8');
const publicationInventory = fs.readFileSync(path.join(root, 'pages-publication-inventory.json'), 'utf8');

new Function(source); // syntax gate
assert(!/=>|\b(?:const|let|class)\b|`/.test(source), 'exact-encounter verifier must remain ES5-compatible');
const liveAssetVersion = /window\.__MLS_AV='([^']+)'/.exec(liveHtml);
const stagingAssetVersion = /window\.__MLS_AV='([^']+)'/.exec(stagingHtml);
assert(liveAssetVersion && stagingAssetVersion && stagingAssetVersion[1] === liveAssetVersion[1], 'ScribeFlow staging feature bundle cache token drifted from production');
assert(stagingHtml.includes("s.src='mls-connect.staging.js?v='+window.__MLS_AV"), 'ScribeFlow staging no longer loads its feature bundle with the deterministic release cache token');
for (const [name, loader] of [['production', connect], ['staging', stagingConnect]]) {
  assert(!/s\.src\s*=\s*A\s*\+\s*['"]\?v=20260719eev130['"]/.test(loader),
    name + ' still loads the live-rejected 2.9.44 exact-encounter owner');
  assert.strictEqual((loader.match(/REJECTED_EEV_ROLLBACK_START/g) || []).length, 1,
    name + ' must have one hot-upgrade rollback for the rejected verifier');
  assert(!loader.includes('Update MLS Assist to v2.9.44'), name + ' still asks the doctor to install the rejected extension');
}
assert(pagesConfig.includes('- "feat_mls_exact_encounter_verify.js"'), 'Pages must exclude the rejected 2.9.44 verifier asset');
assert(!publicationInventory.includes('feat_mls_exact_encounter_verify.js'), 'publication inventory still ships the rejected 2.9.44 verifier');

function between(text, start, end) {
  const a = text.indexOf(start);
  assert(a >= 0, 'missing contract marker: ' + start);
  const b = text.indexOf(end, a + start.length);
  assert(b > a, 'missing contract end marker: ' + end);
  return text.slice(a, b);
}

for (const [name, loader] of [['production', connect], ['staging', stagingConnect]]) {
  let reverts = 0;
  let removals = 0;
  const rejectedScript = {
    parentNode: {
      removeChild(node) {
        assert.strictEqual(node, rejectedScript, name + ' removed the wrong hot-loaded script');
        removals += 1;
      }
    }
  };
  const rollbackWindow = {
    __mlsExactEncounterVerify: {
      revert() { reverts += 1; }
    }
  };
  const rollbackDocument = {
    querySelectorAll(selector) {
      assert.strictEqual(selector, 'script[data-mls-asset="feat_mls_exact_encounter_verify.js"]');
      return [rejectedScript];
    }
  };
  vm.runInNewContext(
    between(loader, '/* REJECTED_EEV_ROLLBACK_START */', '/* REJECTED_EEV_ROLLBACK_END */'),
    { window: rollbackWindow, document: rollbackDocument }
  );
  assert.strictEqual(reverts, 1, name + ' did not revert the already-loaded rejected verifier exactly once');
  assert.strictEqual(removals, 1, name + ' did not remove the rejected verifier script marker');
  assert(!Object.prototype.hasOwnProperty.call(rollbackWindow, '__mlsExactEncounterVerify'),
    name + ' left the rejected verifier global installed after the hot upgrade');
}

// Lock this feature to the public envelopes shipped by the exact 2.9.44
// candidate in this repo: SearchOpen is direct, ActionV2 is wrapped in resp,
// and the background's public probe return carries the locked context but does
// not repeat the driver's internal contextVerified flag at top level.
const openBridge = between(content, '/* (2) Search-and-navigate relay', '/* =========================================================================\n * MLS Assist v1.50');
const actionBridge = between(content, "if (d.type === 'mlsAppAthenaActionV2')", '/* ATHENA_ACTION_V2_BRIDGE_END */');
const actionHandler = between(background, "if (!msg || msg.type !== 'mlsAppAthenaActionV2Request') return;", '/* ATHENA_ACTION_V2_HANDLER_END */');
assert(openBridge.includes("post(requestOrigin, 'mlsAppSearchOpenResult', out)"), '2.9.44 SearchOpen response is no longer a direct envelope');
assert(openBridge.includes('out.requestId = requestId; out.deadlineAt = deadlineAt'), 'SearchOpen no longer echoes request/deadline correlation');
assert(actionBridge.includes("type: 'mlsAppAthenaActionV2Result'") && actionBridge.includes('resp: resp'), 'ActionV2 bridge no longer wraps the response in resp');
assert(actionHandler.includes("return { ok: true, mode: 'probe', action: action, readOnly: true"), 'background read-only probe contract disappeared');
assert(actionHandler.includes('context: probe.context') && actionHandler.includes("noAutomaticChaining: 'no-automatic-chaining'"), 'background probe no longer returns its immutable context proof');

function makeHarness(options) {
  options = options || {};
  const origin = 'https://app.mlsscribe.com';
  const patient = { id: 'pt-17', name: 'Exact Patient', dob: '03/04/1980', mrn: 'MRN-550012' };
  let binding = {
    id: 'visit-bind-1272764709',
    patient: { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn },
    visitContext: {
      appointmentId: '1272764709',
      visitDate: '2026-07-18',
      provider: 'Matthew Schaeffer, MD',
      encounterId: '',
      encounterUrl: ''
    },
    displayDate: '2026-07-18',
    displayProvider: 'Matthew Schaeffer, MD'
  };
  const storage = Object.create(null);
  const localStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem(key, value) {
      if (options.storageFails) throw new Error('quota');
      storage[key] = String(value);
    }
  };
  const helper = { textContent: 'legacy helper', attributes: {}, setAttribute(k, v) { this.attributes[k] = String(v); } };
  const label = { textContent: 'Open Athena encounter' };
  const value = { textContent: 'Open it first', attributes: {}, setAttribute(k, v) { this.attributes[k] = String(v); } };
  const row = { querySelector(selector) { return selector === 'b' ? label : (selector === 'span' ? value : null); } };
  let legacyCalls = 0;
  const button = {
    id: 'mlsSyncVerifyNow', textContent: 'Verify active patient now', disabled: false,
    attributes: {}, parentElement: null,
    setAttribute(k, v) { this.attributes[k] = String(v); },
    onclick() { legacyCalls += 1; }
  };
  const pop = {
    querySelector(selector) { return selector === '.mls-sp-safe' ? helper : null; },
    querySelectorAll(selector) { return selector === '.mls-sp-check' ? [row] : []; }
  };
  button.parentElement = pop;

  const documentListeners = Object.create(null);
  const document = {
    readyState: options.readyState || 'complete',
    body: { innerText: 'Patient contact: wrong.patient@example.net' },
    documentElement: {},
    getElementById(id) { return id === 'mlsSyncVerifyNow' ? button : (id === 'mlsSyncPop' ? pop : null); },
    addEventListener(type, fn, capture) { (documentListeners[type] || (documentListeners[type] = [])).push({ fn, capture: !!capture }); },
    removeEventListener(type, fn) { documentListeners[type] = (documentListeners[type] || []).filter(x => x.fn !== fn); }
  };
  const windowListeners = Object.create(null);
  const outgoing = [];
  const syncReceipts = [];
  let sessionEmail = Object.prototype.hasOwnProperty.call(options, 'accountEmail') ? options.accountEmail : 'Doctor@Example.com';
  let renders = 0;
  let harness = null;
  const window = {
    location: { origin }, localStorage,
    getSessionEmail() { return sessionEmail; },
    getActivePtId() { return patient.id; },
    findPatient(id) { return id === patient.id ? patient : null; },
    activePatient() { return patient; },
    addEventListener(type, fn) { (windowListeners[type] || (windowListeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { windowListeners[type] = (windowListeners[type] || []).filter(x => x !== fn); },
    postMessage(message) {
      outgoing.push(message);
      if (typeof options.respond === 'function') setTimeout(function () { options.respond(message, harness); }, 0);
    },
    crypto: {
      getRandomValues(words) { for (let i = 0; i < words.length; i++) words[i] = 0x10203040 + i; return words; }
    },
    __mlsSync: {
      saveVerifyReceipt(receipt) {
        const key = 'sf_u::doctor@example.com::mlsSyncLog::activePatientVerify';
        assert(localStorage.getItem(key), 'status helper ran before durable localStorage persistence');
        syncReceipts.push(receipt);
      },
      render() { renders += 1; }
    }
  };
  window.window = window;

  const observers = [];
  function MutationObserver(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
  MutationObserver.prototype.observe = function () {};
  MutationObserver.prototype.disconnect = function () { this.disconnected = true; };
  const context = {
    window, document, localStorage, location: window.location, MutationObserver,
    Uint32Array, Promise, Date, Object, Array, String, Number, Math, Error, JSON,
    isFinite, setTimeout, clearTimeout, setInterval, clearInterval, console,
    currentVisitAthenaBinding: binding
  };
  vm.createContext(context);
  let currentApi = null;
  function evaluate() {
    vm.runInContext(source, context, { filename: 'feat_mls_exact_encounter_verify.js' });
    if (window.__mlsExactEncounterVerify) currentApi = window.__mlsExactEncounterVerify;
    return window.__mlsExactEncounterVerify;
  }
  evaluate();

  function emit(data, overrides) {
    overrides = overrides || {};
    (windowListeners.message || []).slice().forEach(function (fn) {
      fn({
        data,
        source: Object.prototype.hasOwnProperty.call(overrides, 'source') ? overrides.source : window,
        origin: Object.prototype.hasOwnProperty.call(overrides, 'origin') ? overrides.origin : origin
      });
    });
  }
  function click(isTrusted) {
    const flags = { prevented: false, stopped: false, immediate: false };
    const event = {
      target: button, isTrusted: isTrusted === true,
      preventDefault() { flags.prevented = true; },
      stopPropagation() { flags.stopped = true; },
      stopImmediatePropagation() { flags.immediate = true; }
    };
    (documentListeners.click || []).filter(x => x.capture).forEach(function (entry) {
      if (!flags.immediate) entry.fn(event);
    });
    if (!flags.immediate && typeof button.onclick === 'function') button.onclick(event);
    return flags;
  }
  function setBinding(next) {
    binding = next;
    context.currentVisitAthenaBinding = next;
    window.currentVisitAthenaBinding = next;
  }
  function cloneBinding() {
    return JSON.parse(JSON.stringify(binding));
  }
  harness = {
    window, document, localStorage, outgoing, storage, syncReceipts, button, helper, label, value, observers,
    emit, click, setBinding, cloneBinding, evaluate,
    setSessionEmail(next) { sessionEmail = next; },
    api() { return window.__mlsExactEncounterVerify || currentApi; },
    state() { return (window.__mlsExactEncounterVerify || currentApi).state(); },
    documentListenerCount(type) { return (documentListeners[type] || []).length; },
    windowListenerCount(type) { return (windowListeners[type] || []).length; },
    legacyCalls() { return legacyCalls; },
    renders() { return renders; },
    receipt() {
      const raw = localStorage.getItem('sf_u::doctor@example.com::mlsSyncLog::activePatientVerify');
      return raw ? JSON.parse(raw)[patient.id] : null;
    }
  };
  return harness;
}

function exactContext(overrides) {
  return Object.assign({
    patientName: 'Exact Patient',
    dob: '3/4/1980',
    mrn: '550012',
    appointmentId: '1272764709',
    encounterId: '987654',
    encounterUrl: 'https://athenanet.athenahealth.com/encounter/987654',
    visitDate: '7/18/2026',
    provider: 'Matthew Schaeffer, MD',
    framePath: '0>3',
    encounterRootFingerprint: 'enc-root-proof',
    controlFingerprint: 'note-control-proof',
    noteScopeFingerprint: 'note-scope-proof',
    actionContainerFingerprint: 'note-scope-proof',
    editorFingerprint: 'note-editor-proof',
    contextHash: 'exact-context-proof-hash'
  }, overrides || {});
}

function standardResponder(config) {
  config = config || {};
  return function (message, h) {
    if (message.type === 'mlsPing') {
      h.emit({ source: 'mls-ext', type: 'mlsPong', requestId: message.requestId, version: config.version || '2.9.44', buildId: config.buildId || '2.9.44+core-sha256:afe50d7af1643aefdeea6d8e3f131efe588a14671376421e9a57b075eb1105a1' });
      return;
    }
    if (message.type === 'mlsAppSearchOpenPatient') {
      if (typeof config.beforeOpenResponse === 'function') config.beforeOpenResponse(h, message);
      h.emit({
        source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: message.requestId, deadlineAt: message.deadlineAt,
        ok: true, opened: true, via: 'appointment-id', appointmentId: message.appointmentId,
        appointmentIdBound: true, athenaTabId: 91,
        appointmentNavigationFrameIds: config.frames || [0, 3]
      });
      return;
    }
    if (message.type === 'mlsAppAthenaActionV2') {
      h.emit({
        source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: message.requestId,
        resp: {
          ok: true, mode: 'probe', action: 'write_note', readOnly: true,
          reason: 'context-verified', noAutomaticChaining: 'no-automatic-chaining',
          athenaTabId: Object.prototype.hasOwnProperty.call(config, 'probeTabId') ? config.probeTabId : 91,
          actionToken: 'ephemeral-never-persist', expiresAt: Date.now() + 30000,
          context: exactContext(config.context)
        }
      });
    }
  };
}

function waitFor(predicate, message) {
  const started = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      if (predicate()) return resolve();
      if (Date.now() - started > 1500) return reject(new Error(message));
      setTimeout(poll, 5);
    })();
  });
}

async function run() {
  // Synthetic activation is captured before the legacy onclick and performs no
  // navigation, read, schedule pull, or write.
  const synthetic = makeHarness();
  assert.strictEqual(synthetic.value.textContent, 'Ready \u2014 this button opens the exact scheduled visit automatically.', 'idle copy still tells the clinician to open Athena manually');
  const syntheticFlags = synthetic.click(false);
  assert(syntheticFlags.prevented && syntheticFlags.stopped && syntheticFlags.immediate, 'synthetic click did not fully capture the legacy Verify button');
  assert.strictEqual(synthetic.legacyCalls(), 0, 'legacy Verify onclick also fired for a captured synthetic click');
  assert.strictEqual(synthetic.outgoing.length, 0, 'synthetic click reached the extension bridge');
  assert.strictEqual(synthetic.state().errorCode, 'trusted-click-required', 'synthetic click did not fail with the trusted-gesture gate');

  // Happy path uses the exact 2.9.44 envelope shapes. It also sends hostile and
  // uncorrelated lookalike envelopes first; neither may advance the chain.
  const happy = makeHarness({
    respond(message, h) {
      h.emit({ source: 'mls-ext', type: message.type === 'mlsPing' ? 'mlsPong' : 'mlsAppSearchOpenResult', requestId: message.requestId }, { origin: 'https://hostile.example' });
      h.emit({ source: 'mls-ext', type: message.type === 'mlsPing' ? 'mlsPong' : 'mlsAppSearchOpenResult', requestId: 'wrong-request' });
      standardResponder({})(message, h);
    }
  });
  const happyFlags = happy.click(true);
  assert(happyFlags.immediate, 'trusted exact-open click did not suppress the legacy onclick');
  await waitFor(() => happy.state().phase === 'success' && !happy.state().busy, 'exact encounter verification did not finish');
  assert.strictEqual(happy.legacyCalls(), 0, 'legacy Verify handler fired alongside the exact-open workflow');
  assert.strictEqual(happy.window.__mlsExactEncounterVerify.version, 'eev-1.3.0', 'unexpected exact-encounter verifier build');
  assert.strictEqual(happy.window.__mlsExactEncounterVerify.minimumExtensionVersion, '2.9.44', 'minimum extension gate drifted');
  assert.strictEqual(happy.window.__mlsExactEncounterVerify.approvedExtensionBuildId, '2.9.44+core-sha256:afe50d7af1643aefdeea6d8e3f131efe588a14671376421e9a57b075eb1105a1', 'approved exact-encounter extension build drifted');
  assert.deepStrictEqual(happy.outgoing.map(x => x.type), ['mlsPing', 'mlsAppSearchOpenPatient', 'mlsAppAthenaActionV2'], 'verification sent an extra or out-of-order bridge command');
  const open = happy.outgoing[1];
  assert.strictEqual(open.appointmentId, '1272764709', 'exact numeric appointment identity changed');
  assert.strictEqual(open.bootstrapIdentity, true, 'exact appointment bootstrap was not required');
  assert.strictEqual(open.scheduleDate, '2026-07-18', 'selected schedule date was omitted');
  assert(open.requestId && Number.isFinite(open.deadlineAt) && open.deadlineAt > Date.now(), 'open request lacks correlation/deadline');
  assert.strictEqual(open.name, 'Exact Patient');
  assert.strictEqual(open.dob, '03/04/1980');
  assert.strictEqual(open.mrn, 'MRN-550012');
  const probe = happy.outgoing[2];
  assert.strictEqual(probe.mode, 'probe', 'Athena action was not read-only probe mode');
  assert.strictEqual(probe.action, 'write_note', 'unexpected typed Athena action');
  assert.strictEqual(probe.expectedAthenaTabId, 91, 'read-only probe was not pinned to the tab that proved the exact appointment open');
  assert.strictEqual(probe.expectedPatient.name, 'Exact Patient');
  assert.strictEqual(probe.expectedPatient.dob, '03/04/1980');
  assert.strictEqual(probe.expectedPatient.mrn, 'MRN-550012');
  assert.strictEqual(probe.expectedContext.appointmentId, '1272764709');
  assert.strictEqual(probe.expectedContext.visitDate, '2026-07-18');
  assert.strictEqual(probe.expectedContext.provider, 'Matthew Schaeffer, MD');
  assert(probe.noteText && probe.notePolicy === 'empty_only', 'candidate probe prerequisites were not satisfied safely');
  assert(!happy.outgoing.some(x => x.type === 'mlsAppPullSchedule' || x.mode === 'execute'), 'verification pulled a schedule or requested a write');
  const receipt = happy.receipt();
  assert(receipt && receipt.readOnly === true, 'complete proof was not durably stored');
  assert.strictEqual(receipt.openProof.appointmentIdBound, true);
  assert.strictEqual(receipt.extensionBuildId, happy.window.__mlsExactEncounterVerify.approvedExtensionBuildId, 'receipt omitted the exact approved extension build');
  assert.deepStrictEqual(receipt.openProof.appointmentNavigationFrameIds, [0, 3]);
  assert.strictEqual(receipt.openProof.requestId, open.requestId);
  assert.strictEqual(receipt.openProof.deadlineAt, open.deadlineAt);
  assert.strictEqual(receipt.probeProof.requestId, probe.requestId);
  assert.strictEqual(receipt.probeProof.athenaTabId, 91);
  assert.strictEqual(receipt.probeProof.readOnly, true);
  assert.strictEqual(receipt.context.encounterId, '987654');
  assert.strictEqual(receipt.context.encounterUrl, 'https://athenanet.athenahealth.com/encounter/987654');
  assert.strictEqual(receipt.context.contextHash, 'exact-context-proof-hash');
  assert(!JSON.stringify(receipt).includes('ephemeral-never-persist'), 'ephemeral Athena action token leaked into durable storage');
  assert.strictEqual(happy.localStorage.getItem('sf_u::wrong.patient@example.net::mlsSyncLog::activePatientVerify'), null, 'patient/body email was used as the account storage owner');
  assert.strictEqual(happy.syncReceipts.length, 1, 'status receipt helper was not updated exactly once after persistence');
  assert(/opens only the exact scheduled Athena appointment/i.test(happy.helper.textContent), 'visible safety copy still requires a manually opened encounter');
  const nextVisit = happy.cloneBinding();
  nextVisit.id = 'visit-bind-next-patient-context';
  nextVisit.visitContext.appointmentId = '1272764711';
  happy.setBinding(nextVisit);
  happy.api().decorate();
  assert.strictEqual(happy.state().phase, 'idle', 'success state leaked onto a different patient/visit binding');
  assert.strictEqual(happy.state().lastVerifiedAt, '', 'old verification timestamp leaked onto a new binding');
  assert.strictEqual(happy.value.textContent, 'Ready \u2014 this button opens the exact scheduled visit automatically.', 'new binding inherited the prior visit\'s verified row copy');

  // Old extension: stop before navigation.
  const old = makeHarness({ respond: standardResponder({ version: '2.9.43', buildId: '2.9.43+core-sha256:816d57a660d6ce8244c5ee695615d88ce500700219693ca5b48129d26f77df14' }) });
  old.click(true);
  await waitFor(() => old.state().phase === 'error' && !old.state().busy, 'old-version gate did not settle');
  assert.strictEqual(old.state().errorCode, 'update-required');
  assert.deepStrictEqual(old.outgoing.map(x => x.type), ['mlsPing'], 'old extension was allowed to navigate or probe');
  assert.strictEqual(old.receipt(), null, 'old extension produced a verification receipt');

  // A Web Store rollback can publish older bytes under a numerically newer
  // version. Numeric version alone must never authorize exact encounter open.
  const rolledBackBytes = makeHarness({ respond: standardResponder({ version: '2.9.45', buildId: '2.9.45+core-sha256:old-rollback-bytes' }) });
  rolledBackBytes.click(true);
  await waitFor(() => rolledBackBytes.state().phase === 'error' && !rolledBackBytes.state().busy, 'rollback-build gate did not settle');
  assert.strictEqual(rolledBackBytes.state().errorCode, 'extension-build-unapproved');
  assert.deepStrictEqual(rolledBackBytes.outgoing.map(x => x.type), ['mlsPing'], 'unapproved higher-version rollback bytes were allowed to navigate or probe');
  assert.strictEqual(rolledBackBytes.receipt(), null, 'unapproved rollback bytes produced a verification receipt');

  // Navigation proof must be nonempty, integer, unique frame IDs.
  const badOpen = makeHarness({ respond: standardResponder({ frames: [3, 3] }) });
  badOpen.click(true);
  await waitFor(() => badOpen.state().phase === 'error' && !badOpen.state().busy, 'bad navigation proof did not settle');
  assert.strictEqual(badOpen.state().errorCode, 'navigation-unverified');
  assert(!badOpen.outgoing.some(x => x.type === 'mlsAppAthenaActionV2'), 'probe ran after invalid appointment navigation proof');
  assert.strictEqual(badOpen.receipt(), null, 'invalid navigation proof was stored');

  // More than one Athena row for the exact appointment ID is never guessed.
  const ambiguous = makeHarness({
    respond(message, h) {
      if (message.type === 'mlsPing') return standardResponder({})(message, h);
      if (message.type === 'mlsAppSearchOpenPatient') {
        h.emit({
          source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: message.requestId, deadlineAt: message.deadlineAt,
          ok: false, opened: false, reason: 'appointment-id-ambiguous'
        });
      }
    }
  });
  ambiguous.click(true);
  await waitFor(() => ambiguous.state().phase === 'error' && !ambiguous.state().busy, 'ambiguous appointment gate did not settle');
  assert.strictEqual(ambiguous.state().errorCode, 'open-ambiguous');
  assert(!ambiguous.outgoing.some(x => x.type === 'mlsAppAthenaActionV2'), 'ambiguous appointment advanced to a read-only probe');
  assert.strictEqual(ambiguous.receipt(), null, 'ambiguous appointment produced a receipt');

  // A patient/visit change while the open is in flight invalidates the frozen
  // request before the read-only probe can start.
  const changed = makeHarness({
    respond: standardResponder({
      beforeOpenResponse(h) {
        const next = h.cloneBinding();
        next.id = 'visit-bind-other';
        next.visitContext.appointmentId = '1272764710';
        h.setBinding(next);
      }
    })
  });
  changed.click(true);
  await waitFor(() => changed.state().phase === 'error' && !changed.state().busy, 'context-change abort did not settle');
  assert.strictEqual(changed.state().errorCode, 'binding-changed');
  assert(/old result was discarded/i.test(changed.state().message), 'context-change abort explanation was erased before it could be shown');
  assert(!changed.outgoing.some(x => x.type === 'mlsAppAthenaActionV2'), 'stale open result advanced to probe');
  assert.strictEqual(changed.receipt(), null, 'stale patient/visit result was stored');
  const laterVisit = changed.cloneBinding();
  laterVisit.id = 'visit-bind-later-still';
  laterVisit.visitContext.appointmentId = '1272764712';
  changed.setBinding(laterVisit);
  changed.api().decorate();
  assert.strictEqual(changed.state().phase, 'idle', 'binding-change error leaked past a later distinct visit change');

  // Account ownership is part of the frozen binding. A missing account blocks
  // before extension contact; an account switch during navigation discards the
  // old result instead of writing it under either account.
  const noAccount = makeHarness({ accountEmail: '' });
  noAccount.click(true);
  assert.strictEqual(noAccount.state().errorCode, 'missing-exact-binding', 'missing account did not fail closed');
  assert.strictEqual(noAccount.outgoing.length, 0, 'missing account reached the extension bridge');
  assert.strictEqual(noAccount.receipt(), null, 'missing account produced a receipt');

  const changedAccount = makeHarness({
    respond: standardResponder({
      beforeOpenResponse(h) { h.setSessionEmail('other.clinician@example.com'); }
    })
  });
  changedAccount.click(true);
  await waitFor(() => changedAccount.state().phase === 'error' && !changedAccount.state().busy, 'account-change abort did not settle');
  assert.strictEqual(changedAccount.state().errorCode, 'binding-changed');
  assert(!changedAccount.outgoing.some(x => x.type === 'mlsAppAthenaActionV2'), 'account change advanced to a probe');
  assert.strictEqual(changedAccount.receipt(), null, 'account change wrote under the original account');
  assert.strictEqual(changedAccount.localStorage.getItem('sf_u::other.clinician@example.com::mlsSyncLog::activePatientVerify'), null, 'account change wrote under the replacement account');

  // A probe receipt for any other patient/appointment is complete-looking but
  // still the wrong encounter and therefore cannot be persisted.
  const wrongContext = makeHarness({ respond: standardResponder({ context: { patientName: 'Different Patient', appointmentId: '1272764710' } }) });
  wrongContext.click(true);
  await waitFor(() => wrongContext.state().phase === 'error' && !wrongContext.state().busy, 'wrong-context probe did not settle');
  assert.strictEqual(wrongContext.state().errorCode, 'probe-context-mismatch');
  assert.strictEqual(wrongContext.receipt(), null, 'wrong patient/appointment context was stored');

  // A complete-looking probe from a different Athena tab may never be joined
  // to this appointment navigation proof. This is the exact multi-tab race
  // that previously produced a false composite receipt.
  const wrongTab = makeHarness({ respond: standardResponder({ probeTabId: 92 }) });
  wrongTab.click(true);
  await waitFor(() => wrongTab.state().phase === 'error' && !wrongTab.state().busy, 'wrong-tab probe did not settle');
  assert.strictEqual(wrongTab.state().errorCode, 'probe-tab-mismatch');
  assert.strictEqual(wrongTab.receipt(), null, 'a probe from a different Athena tab was stored');

  // Missing encounter proof never becomes a receipt.
  const incomplete = makeHarness({ respond: standardResponder({ context: { encounterRootFingerprint: '' } }) });
  incomplete.click(true);
  await waitFor(() => incomplete.state().phase === 'error' && !incomplete.state().busy, 'incomplete probe did not settle');
  assert.strictEqual(incomplete.state().errorCode, 'probe-context-incomplete');
  assert.strictEqual(incomplete.receipt(), null, 'incomplete exact-context proof was stored');

  // A complete Athena proof still cannot become green if durable readback fails.
  const noStorage = makeHarness({ storageFails: true, respond: standardResponder({}) });
  noStorage.click(true);
  await waitFor(() => noStorage.state().phase === 'error' && !noStorage.state().busy, 'storage failure did not settle');
  assert.strictEqual(noStorage.state().errorCode, 'receipt-storage-failed');
  assert.strictEqual(noStorage.syncReceipts.length, 0, 'ephemeral status receipt was published after durable storage failure');

  // Installation is single-owner and fully reversible. Re-evaluating while
  // installed cannot duplicate capture listeners or observers; revert removes
  // both and allows a clean new installation.
  const lifecycle = makeHarness();
  const firstApi = lifecycle.api();
  assert.strictEqual(firstApi.installed, true, 'feature did not expose installed lifecycle state');
  assert.strictEqual(lifecycle.documentListenerCount('click'), 1, 'capture listener was not installed exactly once');
  assert.strictEqual(lifecycle.observers.length, 1, 'observer was not installed exactly once');
  assert.strictEqual(lifecycle.evaluate(), firstApi, 'duplicate source evaluation replaced the active owner');
  assert.strictEqual(lifecycle.documentListenerCount('click'), 1, 'duplicate evaluation added a second click listener');
  assert.strictEqual(lifecycle.observers.length, 1, 'duplicate evaluation added a second observer');
  assert.strictEqual(firstApi.revert(), true, 'revert did not report success');
  assert.strictEqual(firstApi.installed, false, 'revert left installed=true');
  assert.strictEqual(lifecycle.documentListenerCount('click'), 0, 'revert left the capture click listener installed');
  assert.strictEqual(lifecycle.observers[0].disconnected, true, 'revert did not disconnect the mutation observer');
  assert.strictEqual(lifecycle.window.__mlsExactEncounterVerify, undefined, 'revert left the disposed global owner installed');
  const secondApi = lifecycle.evaluate();
  assert(secondApi && secondApi !== firstApi && secondApi.installed === true, 'feature could not reinstall cleanly after revert');
  assert.strictEqual(lifecycle.documentListenerCount('click'), 1, 'clean reinstall did not own exactly one listener');
  assert.strictEqual(lifecycle.observers.length, 2, 'clean reinstall did not create exactly one new observer');
  secondApi.revert();

  // Revert before DOM ready removes the pending listener and never installs an
  // observer/capture handler.
  const pendingDom = makeHarness({ readyState: 'loading' });
  const pendingApi = pendingDom.api();
  assert.strictEqual(pendingApi.installed, false, 'loading document installed too early');
  assert.strictEqual(pendingDom.documentListenerCount('DOMContentLoaded'), 1, 'pending DOMContentLoaded listener missing');
  pendingApi.revert();
  assert.strictEqual(pendingDom.documentListenerCount('DOMContentLoaded'), 0, 'revert left the pending DOMContentLoaded listener');
  assert.strictEqual(pendingDom.documentListenerCount('click'), 0, 'revert-before-ready installed a click listener');
  assert.strictEqual(pendingDom.observers.length, 0, 'revert-before-ready installed an observer');

  // Reverting an in-flight exact open immediately cancels its correlated
  // bridge listener. A late extension result is ignored and cannot start a
  // probe or persist a receipt.
  const inFlight = makeHarness({
    respond(message, h) {
      if (message.type === 'mlsPing') standardResponder({})(message, h);
      // Deliberately hold SearchOpen forever; revert owns cancellation.
    }
  });
  inFlight.click(true);
  await waitFor(() => inFlight.outgoing.some(x => x.type === 'mlsAppSearchOpenPatient'), 'in-flight open never started');
  const inFlightApi = inFlight.api();
  const heldOpen = inFlight.outgoing.find(x => x.type === 'mlsAppSearchOpenPatient');
  inFlightApi.revert();
  assert.strictEqual(inFlight.windowListenerCount('message'), 0, 'revert left an in-flight bridge listener');
  inFlight.emit({
    source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: heldOpen.requestId, deadlineAt: heldOpen.deadlineAt,
    ok: true, opened: true, via: 'appointment-id', appointmentId: heldOpen.appointmentId,
    appointmentIdBound: true, athenaTabId: 91, appointmentNavigationFrameIds: [0, 3]
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.strictEqual(inFlightApi.state().phase, 'disposed', 'late in-flight result changed disposed state');
  assert(!inFlight.outgoing.some(x => x.type === 'mlsAppAthenaActionV2'), 'late result started a probe after revert');
  assert.strictEqual(inFlight.receipt(), null, 'late result persisted a receipt after revert');

  console.log('PASS rejected 2.9.44 exact verifier stays isolated and testable while production/staging omit, exclude, and never demand it from the restored 2.9.43 path');
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
