'use strict';

/* Safe live-current Athena encounter discovery.
 *
 * This is a wholly synthetic worker harness. It never opens Athena, never
 * touches a browser profile, and its execute injection returns a refusal
 * without running the in-page driver. The runtime cases pin the contract that
 * a current reviewed note may begin with complete patient identity and an
 * entirely empty local visit locator, while mutation authority exists only
 * after exactly one complete encounter lock is returned.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const FLOW = fs.readFileSync(path.join(ROOT, '1p-feat_mls_writeflow.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const HANDLER = between(BACKGROUND, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */');
const DRIVER = between(BACKGROUND, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */');
const RECEIPT = between(FLOW, 'function resultToUnifiedReceipt(state, row, resp, probe)', 'function executeUnifiedSelection(state)');

/* The in-page read-only driver is the last arbiter inside one Athena tab: zero
 * and multiple matching encounter frames are equally non-authorizing. */
assert(/if \(candidates\.length !== 1\) return \{ ok: false, blocked: true/.test(DRIVER),
  'the Athena driver no longer requires exactly one matching encounter frame');

/* A DOM insertion/readback is not durable Athena persistence. The visible
 * receipt must name what was actually proved and explicitly say it is unsaved. */
assert(/Inserted into the exact Athena field and read back successfully\./.test(RECEIPT),
  'the note receipt does not say the exact field was inserted and read back');
assert(/It has not been saved or signed\./.test(RECEIPT),
  'the note receipt does not disclose that the inserted field remains unsaved');
assert(!/unsigned note was written and verified|note was written and verified/i.test(RECEIPT),
  'the note receipt still calls an unsaved editor insertion written/verified');

const PATIENT = {
  patientId: 'synthetic-patient-1',
  name: 'Synthetic Current Patient',
  dob: '01/02/1980',
  mrn: '100001'
};
const NOTE = 'Synthetic reviewed note body.';
const EMPTY_CONTEXT = Object.freeze({ appointmentId: '', encounterId: '', encounterUrl: '', visitDate: '', provider: '' });

function lock(encounterId, appointmentId) {
  return {
    patientName: PATIENT.name,
    dob: '1/2/1980',
    mrn: PATIENT.mrn,
    appointmentId: String(appointmentId || '700001'),
    encounterId: String(encounterId),
    encounterUrl: `https://athenanet.athenahealth.com/encounter/${encounterId}`,
    visitDate: '8/23/2026',
    provider: 'Synthetic Clinician, MD',
    framePath: 'top.0',
    encounterRootFingerprint: `encounter-root-${encounterId}`,
    controlFingerprint: `control-${encounterId}`,
    noteScopeFingerprint: `note-scope-${encounterId}`,
    editorFingerprint: `editor-${encounterId}`,
    contextHash: `context-${encounterId}`,
    controlLabel: 'Encounter note editor'
  };
}

function probeSuccess(context) {
  return {
    ok: true,
    mode: 'probe',
    action: 'write_note',
    readOnly: true,
    reason: 'context-verified',
    contextVerified: true,
    context
  };
}

function request(overrides) {
  return Object.assign({
    type: 'mlsAppAthenaActionV2Request',
    mode: 'probe',
    action: 'write_note',
    foregroundOk: false,
    previewHash: 'preview-live-unbound',
    manifestHash: 'manifest-live-unbound',
    expectedPatient: Object.assign({}, PATIENT),
    expectedContext: Object.assign({}, EMPTY_CONTEXT),
    noteText: NOTE,
    sections: [{ key: 'note', text: NOTE, execute: true, destination: 'Athena encounter > Encounter note' }],
    notePolicy: 'empty_only',
    billing: {},
    order: {},
    rowHash: '',
    clientOrderId: ''
  }, overrides || {});
}

function makeHarness(tabProbeResults) {
  const listeners = [];
  const injections = [];
  const tabs = tabProbeResults.map((result, index) => ({
    id: 200 + index,
    url: `https://athenanet.athenahealth.com/1/${index + 1}/encounter`
  }));
  let tokenSerial = 10;
  const self = {
    MLSWriteSafety: {
      gateActionRequest() { return null; },
      async verifyAccountPracticeGate() { return null; }
    }
  };
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } },
    tabs: {
      async query() { return tabs.slice(); },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      sendMessage() {}
    },
    webNavigation: { onBeforeNavigate: { addListener() {} } },
    scripting: {
      async unregisterContentScripts() {},
      async registerContentScripts() {},
      async executeScript(spec) {
        const payload = spec && spec.args && spec.args[0] || {};
        injections.push({ tabId: spec.target.tabId, payload: JSON.parse(JSON.stringify(payload)) });
        if (payload.mode === 'execute') {
          /* Deliberately do not invoke the driver or mutate a DOM. Reaching
             this stub proves only that the full-lock authorization gates
             accepted the synthetic request. */
          return [{ result: { ok: false, blocked: true, attempted: false, reason: 'synthetic-no-mutation' } }];
        }
        const index = tabs.findIndex(tab => tab.id === spec.target.tabId);
        return [{ result: tabProbeResults[index] }];
      }
    }
  };
  const context = vm.createContext({
    self, chrome, console, URL, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp,
    Uint32Array,
    crypto: { getRandomValues(values) { for (let i = 0; i < values.length; i += 1) values[i] = tokenSerial++; return values; } },
    setTimeout, clearTimeout,
    mlsAthenaActionV2DriverFn() {},
    mlsAthTabHost(tab) { try { return new URL(tab.url).hostname; } catch (_) { return ''; } },
    mlsAthIsLoginish() { return false; }
  });
  vm.runInContext(HANDLER, context, { filename: 'athena-action-v2-handler.js' });

  function dispatch(message) {
    return new Promise((resolve, reject) => {
      let handled = false;
      const timer = setTimeout(() => reject(new Error(`handler did not answer ${message.mode}/${message.action}`)), 1000);
      const reply = value => { clearTimeout(timer); resolve(value); };
      for (const listener of listeners) {
        const result = listener(message, { tab: { id: 91, url: 'https://mlsscribe.com/1p/' } }, reply);
        if (result === true) { handled = true; break; }
      }
      if (!handled) { clearTimeout(timer); reject(new Error(`no listener handled ${message.mode}/${message.action}`)); }
    });
  }

  return { dispatch, injections };
}

(async function main() {
  const firstLock = lock('800001', '700001');

  /* A wholly empty visit locator is allowed only for the read-only probe. One
   * complete verified lock is returned and the token is bound to it. */
  {
    const h = makeHarness([probeSuccess(firstLock)]);
    const response = await h.dispatch(request());
    assert.strictEqual(response.ok, true, `empty-context probe was refused: ${JSON.stringify(response)}`);
    assert.strictEqual(response.mode, 'probe');
    assert.strictEqual(response.readOnly, true);
    assert(response.actionToken, 'the one exact discovered lock did not mint a short-lived token');
    assert.deepStrictEqual(response.context, firstLock, 'the exact discovered encounter lock was not returned intact');
    assert.strictEqual(h.injections.length, 1, 'the one-tab discovery probe did not run exactly once');
    assert.strictEqual(h.injections[0].payload.mode, 'probe');
    assert.deepStrictEqual(h.injections[0].payload.expectedContext, EMPTY_CONTEXT,
      'the worker guessed visit context before the read-only driver discovered it');

    /* Empty context is never sufficient at execute time, even with a valid
     * discovery token and complete probe fingerprint. It must fail before an
     * execute injection. */
    const emptyExecute = await h.dispatch(request({
      mode: 'execute',
      actionToken: response.actionToken,
      expectedContext: Object.assign({}, EMPTY_CONTEXT),
      probeContext: Object.assign({}, firstLock),
      userGesture: true,
      gestureProof: 'synthetic-trusted-gesture'
    }));
    assert.strictEqual(emptyExecute.ok, false);
    assert.strictEqual(emptyExecute.reason, 'context-mismatch', 'empty execute context escaped the full-lock gate');
    assert.strictEqual(h.injections.filter(entry => entry.payload.mode === 'execute').length, 0,
      'empty execute context reached the mutation driver');

    /* Mint a fresh token, then prove the discovered full locator plus complete
     * probe fingerprint reaches only our non-mutating stub. This catches a
     * token that remains bound to the original empty request instead of the
     * stronger discovered lock. */
    const secondProbe = await h.dispatch(request({ previewHash: 'preview-live-unbound-2', manifestHash: 'manifest-live-unbound-2' }));
    assert.strictEqual(secondProbe.ok, true);
    const fullLocator = {
      appointmentId: firstLock.appointmentId,
      encounterId: firstLock.encounterId,
      encounterUrl: firstLock.encounterUrl,
      visitDate: firstLock.visitDate,
      provider: firstLock.provider
    };
    const fullExecute = await h.dispatch(request({
      mode: 'execute',
      previewHash: 'preview-live-unbound-2',
      manifestHash: 'manifest-live-unbound-2',
      actionToken: secondProbe.actionToken,
      expectedContext: fullLocator,
      probeContext: Object.assign({}, firstLock),
      userGesture: true,
      gestureProof: 'synthetic-trusted-gesture-2'
    }));
    assert.strictEqual(fullExecute.reason, 'synthetic-no-mutation',
      `a complete discovered lock did not pass the authorization gates: ${JSON.stringify(fullExecute)}`);
    const executeCalls = h.injections.filter(entry => entry.payload.mode === 'execute');
    assert.strictEqual(executeCalls.length, 1, 'the full discovered lock did not reach exactly one synthetic execute boundary');
    assert.deepStrictEqual(executeCalls[0].payload.expectedContext, fullLocator, 'the execute driver did not receive the full frozen locator');
    assert.deepStrictEqual(executeCalls[0].payload.locked, firstLock, 'the execute driver did not receive the original discovered lock');
  }

  /* No verified lock remains a refusal with no token. */
  {
    const h = makeHarness([{ ok: false, blocked: true, reason: 'context-unverified' }]);
    const response = await h.dispatch(request());
    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.reason, 'context-unverified');
    assert.strictEqual(response.actionToken, undefined);
    assert.strictEqual(response.diag.verifiedTabs, 0);
    assert.strictEqual(h.injections.filter(entry => entry.payload.mode === 'execute').length, 0);
  }

  /* Discovery is not a partial-context repair lane. Once any locator field is
   * supplied, the normal date/provider/exact-id shape is required so the app's
   * request-bound auto-bind path remains the only repair for partial rows. */
  {
    const h = makeHarness([probeSuccess(firstLock)]);
    const response = await h.dispatch(request({
      expectedContext: { appointmentId: firstLock.appointmentId, encounterId: '', encounterUrl: '', visitDate: firstLock.visitDate, provider: '' }
    }));
    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.reason, 'context-mismatch');
    assert.strictEqual(h.injections.length, 0, 'a partial locator reached the discovery driver');
  }

  /* Two independently complete locks are ambiguous. The worker may not pick
   * either tab or return either token. */
  {
    const h = makeHarness([probeSuccess(firstLock), probeSuccess(lock('800002', '700002'))]);
    const response = await h.dispatch(request());
    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.reason, 'ambiguous-athena-tabs');
    assert.strictEqual(response.actionToken, undefined);
    assert.strictEqual(h.injections.length, 2, 'the worker did not inspect every candidate tab read-only');
    assert(h.injections.every(entry => entry.payload.mode === 'probe'), 'an ambiguous discovery crossed the mutation boundary');
  }

  console.log('PASS Athena live-unbound discovery: current note empty-context probe -> exactly one full lock; zero/multiple fail closed; execute requires the frozen full lock; insertion receipt says read back and unsaved');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
