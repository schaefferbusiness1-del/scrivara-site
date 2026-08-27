'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing ${end}`);
  return source.slice(a + begin.length, b);
}

const handlerSource = '/* ATHENA_ACTION_V2_HANDLER_START */' +
  between(background, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const lockedContext = {
  patientName: 'Example Patient', dob: '1/2/1980', mrn: '12345',
  appointmentId: '54321', encounterId: '77777',
  encounterUrl: 'https://athenanet.athenahealth.com/22724/6/encounter/77777',
  visitDate: '7/14/2026', provider: 'Example Doctor MD', framePath: 'top.0',
  encounterRootFingerprint: 'root-fp', controlFingerprint: 'hpi-fp',
  noteScopeFingerprint: 'note-fp', actionContainerFingerprint: 'note-fp',
  editorFingerprint: 'hpi-fp', contextHash: 'context-fp', controlLabel: 'HPI'
};
const sender = { tab: { id: 44, url: 'https://mlsscribe.com/ScribeFlow.html' } };
const patient = {
  name: 'Example Patient', dob: '01/02/1980', mrn: '12345', patientId: 'local-patient-7'
};
const probeMessage = {
  type: 'mlsAppAthenaActionV2Request', mode: 'probe', action: 'write_note',
  previewHash: 'preview-note-7', manifestHash: 'manifest-note-7',
  expectedPatient: patient,
  expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor MD', appointmentId: '54321' },
  noteText: 'HPI:\nThe patient reports improved function.', notePolicy: 'empty_only',
  billing: {}, order: {}, rowHash: '', clientOrderId: '',
  sections: [{ key: 'hpi', text: 'The patient reports improved function.', execute: true, destination: 'HPI' }]
};
const exactOrder = {
  clientOrderId: 'local-order-1', type: 'imaging', displayLabel: 'MRI Lumbar spine',
  catalogCode: '', catalogId: 'athena-catalog-imaging-17', query: 'MRI Lumbar spine',
  fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Persistent radicular pain' },
  reviewStatus: 'accepted', source: 'provider-entered'
};

function orderProbeMessage(clientOrderId, rowHash, previewHash = 'preview-order-atomic') {
  const order = { ...exactOrder, clientOrderId };
  return {
    ...probeMessage, action: 'place_order', previewHash, noteText: '', sections: [],
    order, rowHash, clientOrderId
  };
}

function executeMessageFor(request, probe, overrides = {}) {
  return {
    ...request,
    mode: 'execute',
    actionToken: probe.actionToken,
    expectedContext: {
      appointmentId: probe.context.appointmentId, encounterId: probe.context.encounterId,
      encounterUrl: probe.context.encounterUrl, visitDate: probe.context.visitDate,
      provider: probe.context.provider
    },
    probeContext: clone(lockedContext), userGesture: true, gestureProof: 'trusted-click',
    ...overrides
  };
}

function executeMessage(probe, overrides = {}) {
  return executeMessageFor(probeMessage, probe, overrides);
}

function makeSessionStore() {
  const values = Object.create(null);
  let failSet = false;
  let dropSet = false;
  let failSetPrefix = '';
  let dropSetPrefix = '';
  let dropBatchSet = false;
  let failRemove = false;
  let dropRemove = false;
  let failRemovePrefix = '';
  let dropRemovePrefix = '';
  let localTouches = 0;
  const setHistory = [];
  const alarmsByName = Object.create(null);
  const alarmListeners = [];
  return {
    values,
    setFailSet(value) { failSet = value; },
    setDropSet(value) { dropSet = value; },
    setFailSetPrefix(value) { failSetPrefix = String(value || ''); },
    setDropSetPrefix(value) { dropSetPrefix = String(value || ''); },
    setDropBatchSet(value) { dropBatchSet = value; },
    setFailRemove(value) { failRemove = value; },
    setDropRemove(value) { dropRemove = value; },
    setFailRemovePrefix(value) { failRemovePrefix = String(value || ''); },
    setDropRemovePrefix(value) { dropRemovePrefix = String(value || ''); },
    get localTouches() { return localTouches; },
    get setHistory() { return clone(setHistory); },
    get scheduledAlarm() {
      const alarms = Object.values(alarmsByName).sort((a, b) => a.scheduledTime - b.scheduledTime);
      return clone(alarms[0]);
    },
    get alarmNames() { return Object.keys(alarmsByName); },
    async fireAlarm(name) {
      const alarm = name ? alarmsByName[name] : Object.values(alarmsByName).sort((a, b) => a.scheduledTime - b.scheduledTime)[0];
      if (!alarm) return;
      const fired = clone(alarm);
      delete alarmsByName[alarm.name];
      await Promise.all(alarmListeners.map(listener => listener(fired)));
    },
    alarms: {
      async get(name) { return alarmsByName[name] ? clone(alarmsByName[name]) : undefined; },
      async create(name, info) { alarmsByName[name] = { name, scheduledTime: Number(info && info.when) }; },
      async clear(name) { const existed = !!alarmsByName[name]; delete alarmsByName[name]; return existed; },
      onAlarm: { addListener(listener) { alarmListeners.push(listener); } }
    },
    session: {
      async get(key) {
        if (key == null) return clone(values);
        if (typeof key === 'string') return Object.prototype.hasOwnProperty.call(values, key)
          ? { [key]: clone(values[key]) } : {};
        if (Array.isArray(key)) {
          const out = {};
          for (const item of key) if (Object.prototype.hasOwnProperty.call(values, item)) out[item] = clone(values[item]);
          return out;
        }
        throw new Error('unsupported fake session key');
      },
      async set(items) {
        setHistory.push(Object.keys(items));
        if (failSet) throw new Error('simulated session write failure');
        if (failSetPrefix && Object.keys(items).some(key => key.startsWith(failSetPrefix))) {
          throw new Error('simulated scoped session write failure');
        }
        if (dropSet || (dropBatchSet && Object.keys(items).length > 1) || (dropSetPrefix && Object.keys(items).some(key => key.startsWith(dropSetPrefix)))) return;
        Object.assign(values, clone(items));
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        if (failRemove || (failRemovePrefix && list.some(key => key.startsWith(failRemovePrefix)))) {
          throw new Error('simulated session removal failure');
        }
        if (dropRemove || (dropRemovePrefix && list.some(key => key.startsWith(dropRemovePrefix)))) return;
        for (const key of list) delete values[key];
      }
    },
    forbiddenArea: {
      get() { localTouches++; throw new Error('tokens must never read local/sync storage'); },
      set() { localTouches++; throw new Error('tokens must never write local/sync storage'); }
    }
  };
}

let tokenCounter = 0;
function makeWorker(store, options = {}) {
  let listener = null;
  let executeCalls = 0;
  const liveAthenaTabs = [{ id: 91, url: lockedContext.encounterUrl }];
  const context = {
    self: {}, URL, Date, Math, JSON, Object, Array, String, Number, RegExp, Uint32Array, Promise,
    crypto: {
      getRandomValues(a) {
        tokenCounter++;
        for (let i = 0; i < a.length; i++) a[i] = tokenCounter * 100 + i;
        return a;
      }
    },
    mlsAthTabHost: () => 'athenanet.athenahealth.com',
    mlsAthIsLoginish: () => false,
    mlsAthenaActionV2DriverFn() {},
    chrome: {
      runtime: {
        id: 'mls-test-extension',
        onMessage: { addListener(fn) { listener = fn; } }
      },
      storage: {
        session: store.session,
        local: store.forbiddenArea,
        sync: store.forbiddenArea
      },
      alarms: store.alarms,
      tabs: {
        async query() { return liveAthenaTabs.map(clone); },
        async get(id) { return clone(liveAthenaTabs.find(tab => tab.id === id)); }
      },
      scripting: {
        async executeScript(details) {
          const request = details.args[0];
          if (request.mode === 'probe') {
            return [{ result: {
              ok: true, contextVerified: true, readOnly: true,
              reason: 'note-workspace-context-verified', context: clone(lockedContext)
            } }];
          }
          executeCalls++;
          if (options.holdExecute) await options.holdExecute;
          const configuredResult = typeof options.executeResult === 'function'
            ? options.executeResult(request)
            : options.executeResult;
          return [{ result: configuredResult || {
            ok: true, attempted: true, written: true, verified: true, draftVerified: true,
            reason: 'one-exact-note-isolated-readback-verified', context: clone(lockedContext)
          } }];
        }
      }
    }
  };
  context.self.MLSWriteSafety = {
    gateActionRequest() { return null; },
    async verifyAccountPracticeGate() { return null; }
  };
  vm.createContext(context);
  vm.runInContext(handlerSource, context);
  assert.strictEqual(typeof listener, 'function', 'typed Athena action handler did not wire');
  return {
    get executeCalls() { return executeCalls; },
    send(message) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const ret = listener(message, sender, value => { settled = true; resolve(value); });
        if (ret !== true && !settled) reject(new Error('handler did not keep the response channel open'));
      });
    }
  };
}

function onlyTokenEntry(store) {
  const keys = Object.keys(store.values).filter(key => key.startsWith('mlsAthenaActionV3Token.'));
  assert.strictEqual(keys.length, 1, 'expected exactly one persisted action token');
  return { key: keys[0], record: store.values[keys[0]] };
}

function tokenEntry(store, token) {
  const key = `mlsAthenaActionV3Token.${token}`;
  assert(store.values[key], `missing persisted action token ${token}`);
  return { key, record: store.values[key] };
}

function proofEntry(store, proof) {
  const key = `mlsAthenaNoteWriteProofV1.${proof}`;
  assert(store.values[key], `missing persisted note-write proof ${proof}`);
  return { key, record: store.values[key] };
}

function assertRedactedTerminal(record, label) {
  assert.strictEqual(record.redacted, true, `${label} was not reduced to a terminal tombstone`);
  for (const key of ['locked', 'expectedContext', 'notePayload', 'orderPayload', 'billingPayload',
    'taughtDestinationPayload', 'patientId', 'patientHash', 'expectedMrn', 'expectedAccount',
    'expectedPracticeId', 'patientKey', 'lockedContextKey']) {
    assert.strictEqual(record[key], undefined, `${label} retained sensitive ${key}`);
  }
}

(async () => {
  // The production failure: a clinician probes, reviews for long enough that
  // Chrome discards the MV3 worker, then clicks once. The fresh worker must
  // hydrate the exact browser-session token and perform one verified write.
  const restartStore = makeSessionStore();
  const firstWorker = makeWorker(restartStore);
  const restartProbe = await firstWorker.send(probeMessage);
  assert(restartProbe.ok && restartProbe.readOnly && restartProbe.actionToken,
    'probe did not mint a durable read-only token');
  assert(restartStore.scheduledAlarm && restartStore.scheduledAlarm.scheduledTime >= restartProbe.expiresAt,
    'ready exact-binding token did not schedule browser-session expiry cleanup');
  const persisted = onlyTokenEntry(restartStore);
  assert.strictEqual(persisted.record.schema, 'mls-athena-action-token-v3');
  assert.strictEqual(persisted.record.state, 'ready');
  assert(restartProbe.expiresAt - persisted.record.issuedAt >= 9 * 60 * 1000,
    'review window is still too short for a real clinician');
  assert.strictEqual(restartStore.localTouches, 0, 'authorization state touched durable local/sync storage');

  const restartedWorker = makeWorker(restartStore);
  const restartResult = await restartedWorker.send(executeMessage(restartProbe));
  assert.strictEqual(restartResult.ok, true, 'fresh worker could not execute the exact probed note');
  assert.strictEqual(restartResult.draftVerified, true);
  assert.strictEqual(restartedWorker.executeCalls, 1, 'restart path injected more than one mutation');
  assert.strictEqual(restartStore.localTouches, 0, 'restart path touched local/sync storage');
  const settledToken = tokenEntry(restartStore, restartProbe.actionToken).record;
  assert.strictEqual(settledToken.state, 'settled');
  assertRedactedTerminal(settledToken, 'settled action token');

  const replayWorker = makeWorker(restartStore);
  const replay = await replayWorker.send(executeMessage(restartProbe, { gestureProof: 'replay-click' }));
  assert.strictEqual(replay.reason, 'token-used', 'settled token became replayable after another worker restart');
  assert.strictEqual(replayWorker.executeCalls, 0, 'replay reached the Athena driver');
  settledToken.issuedAt = Date.now() - 10000;
  settledToken.expiresAt = Date.now() - 1;
  await restartStore.fireAlarm();
  assert.strictEqual(restartStore.values[persisted.key], undefined,
    'expiry alarm retained a redacted settled action-token tombstone');

  // Sign is also an action-token consumer, but it has a second one-use
  // prerequisite: the verified note-write proof. A ready Sign token must not
  // become unusable merely because MV3 discarded the worker that minted it.
  const signStore = makeSessionStore();
  const signWorker = makeWorker(signStore);
  const writeProbe = await signWorker.send({ ...probeMessage, previewHash: 'preview-sign-restart' });
  const writeResult = await signWorker.send(executeMessage(writeProbe, {
    previewHash: 'preview-sign-restart', gestureProof: 'write-before-sign'
  }));
  assert(writeResult.ok && writeResult.noteWriteProof, 'verified note write did not mint its exact Sign prerequisite');
  const persistedWriteProof = proofEntry(signStore, writeResult.noteWriteProof);
  assert.strictEqual(persistedWriteProof.record.state, 'ready');
  const signProbeMessage = {
    ...probeMessage, action: 'sign_encounter', previewHash: 'preview-sign-restart',
    noteWriteProof: writeResult.noteWriteProof
  };
  const signProbe = await signWorker.send(signProbeMessage);
  assert(signProbe.ok && signProbe.actionToken, 'Sign probe did not mint an exact action token');
  assert(signProbe.expiresAt <= persistedWriteProof.record.expiresAt,
    'Sign token advertised validity beyond its verified-write prerequisite');
  assert(tokenEntry(signStore, signProbe.actionToken).record.noteWriteProof === writeResult.noteWriteProof,
    'persisted Sign token lost its exact verified-write prerequisite id');

  const restartedSignWorker = makeWorker(signStore, {
    executeResult(request) {
      return request.action === 'sign_encounter'
        ? { ok: true, attempted: true, verified: true, signed: true, reason: 'exact-sign-control-context-verified', context: clone(lockedContext) }
        : null;
    }
  });
  const signResult = await restartedSignWorker.send(executeMessageFor(signProbeMessage, signProbe, {
    gestureProof: 'sign-after-restart'
  }));
  assert.strictEqual(signResult.ok, true,
    'fresh worker lost the exact verified-write prerequisite behind a ready Sign token');
  assert.strictEqual(signResult.signed, true);
  assert.strictEqual(restartedSignWorker.executeCalls, 1, 'restart Sign path injected more than one mutation');
  assertRedactedTerminal(proofEntry(signStore, writeResult.noteWriteProof).record,
    'consumed verified-write proof');
  assertRedactedTerminal(tokenEntry(signStore, signProbe.actionToken).record,
    'settled Sign token');
  const usedProofTombstone = proofEntry(signStore, writeResult.noteWriteProof);
  const settledSignTombstone = tokenEntry(signStore, signProbe.actionToken);
  for (const terminalEntry of [usedProofTombstone, settledSignTombstone]) {
    terminalEntry.record.issuedAt = Date.now() - 10000;
    terminalEntry.record.expiresAt = Date.now() - 1;
  }
  await signStore.fireAlarm();
  assert.strictEqual(signStore.values[usedProofTombstone.key], undefined,
    'expiry alarm retained a redacted used note-proof tombstone');
  assert.strictEqual(signStore.values[settledSignTombstone.key], undefined,
    'expiry alarm retained a redacted settled Sign-token tombstone');

  // The proof itself must survive a restart before the Sign probe, and exactly
  // one of two independently minted Sign tokens may consume it.
  const proofRestartStore = makeSessionStore();
  const proofWriter = makeWorker(proofRestartStore);
  const proofWriteProbe = await proofWriter.send({ ...probeMessage, previewHash: 'preview-proof-restart' });
  const proofWrite = await proofWriter.send(executeMessage(proofWriteProbe, {
    previewHash: 'preview-proof-restart', gestureProof: 'proof-write'
  }));
  assert(proofWrite.ok && proofWrite.noteWriteProof);
  const proofSignMessage = {
    ...probeMessage, action: 'sign_encounter', previewHash: 'preview-proof-restart',
    noteWriteProof: proofWrite.noteWriteProof
  };
  const proofRestartWorker = makeWorker(proofRestartStore);
  const [signProbeA, signProbeB] = await Promise.all([
    proofRestartWorker.send(proofSignMessage),
    proofRestartWorker.send(proofSignMessage)
  ]);
  assert(signProbeA.ok && signProbeB.ok, 'fresh worker could not hydrate the verified-write proof for Sign probing');
  const firstSign = await proofRestartWorker.send(executeMessageFor(proofSignMessage, signProbeA, {
    gestureProof: 'first-sign-proof-claim'
  }));
  const secondSign = await proofRestartWorker.send(executeMessageFor(proofSignMessage, signProbeB, {
    gestureProof: 'second-sign-proof-claim'
  }));
  assert.strictEqual(firstSign.ok, true, 'first exact Sign proof claim was refused');
  assert.strictEqual(secondSign.reason, 'note-write-proof-used',
    'the same verified-write proof authorized a second Sign token');
  assert.strictEqual(proofRestartWorker.executeCalls, 1, 'one verified-write proof reached Sign mutation twice');

  // A rejected terminal write after a proof claim must burn the ready proof
  // before returning. A second pre-minted Sign token in a fresh worker may not
  // revive that prerequisite when storage recovers.
  const proofClaimFailureStore = makeSessionStore();
  const proofClaimWriter = makeWorker(proofClaimFailureStore);
  const proofClaimWriteProbe = await proofClaimWriter.send({ ...probeMessage, previewHash: 'preview-proof-claim-failure' });
  const proofClaimWrite = await proofClaimWriter.send(executeMessage(proofClaimWriteProbe, {
    previewHash: 'preview-proof-claim-failure', gestureProof: 'proof-before-claim-failure'
  }));
  assert(proofClaimWrite.ok && proofClaimWrite.noteWriteProof);
  const proofClaimSignMessage = {
    ...probeMessage, action: 'sign_encounter', previewHash: 'preview-proof-claim-failure',
    noteWriteProof: proofClaimWrite.noteWriteProof
  };
  const proofClaimWorker = makeWorker(proofClaimFailureStore);
  const [failedProofSignToken, proofReplaySignToken] = await Promise.all([
    proofClaimWorker.send(proofClaimSignMessage), proofClaimWorker.send(proofClaimSignMessage)
  ]);
  assert(failedProofSignToken.ok && proofReplaySignToken.ok);
  proofClaimFailureStore.setFailSetPrefix('mlsAthenaNoteWriteProofV1.');
  const failedProofClaim = await proofClaimWorker.send(executeMessageFor(
    proofClaimSignMessage, failedProofSignToken, { gestureProof: 'failed-proof-terminal-write' }
  ));
  assert.strictEqual(failedProofClaim.reason, 'token-state-unavailable');
  assert.strictEqual(proofClaimWorker.executeCalls, 0,
    'failed proof-claim persistence reached the Athena driver');
  assert.strictEqual(proofClaimFailureStore.values[`mlsAthenaNoteWriteProofV1.${proofClaimWrite.noteWriteProof}`], undefined,
    'failed proof-claim persistence left the ready prerequisite recoverable');
  proofClaimFailureStore.setFailSetPrefix('');
  const proofClaimReplayWorker = makeWorker(proofClaimFailureStore);
  const failedProofReplay = await proofClaimReplayWorker.send(executeMessageFor(
    proofClaimSignMessage, proofReplaySignToken, { gestureProof: 'proof-claim-replay-after-restart' }
  ));
  assert.strictEqual(failedProofReplay.reason, 'verified-note-write-required',
    'failed proof-claim persistence revived a ready proof after worker restart');
  assert.strictEqual(proofClaimReplayWorker.executeCalls, 0,
    'replayed proof after failed claim persistence reached the Athena driver');

  for (const outageMode of ['throw', 'silent-drop']) {
    const combinedProofStore = makeSessionStore();
    const combinedProofWriter = makeWorker(combinedProofStore);
    const combinedWriteProbe = await combinedProofWriter.send({
      ...probeMessage, previewHash: `preview-proof-combined-${outageMode}`
    });
    const combinedWrite = await combinedProofWriter.send(executeMessage(combinedWriteProbe, {
      previewHash: `preview-proof-combined-${outageMode}`, gestureProof: `proof-combined-write-${outageMode}`
    }));
    assert(combinedWrite.ok && combinedWrite.noteWriteProof);
    const combinedSignMessage = {
      ...probeMessage, action: 'sign_encounter', previewHash: `preview-proof-combined-${outageMode}`,
      noteWriteProof: combinedWrite.noteWriteProof
    };
    const combinedProofWorker = makeWorker(combinedProofStore);
    const [combinedFirstSign, combinedReplaySign] = await Promise.all([
      combinedProofWorker.send(combinedSignMessage), combinedProofWorker.send(combinedSignMessage)
    ]);
    assert(combinedFirstSign.ok && combinedReplaySign.ok,
      `${outageMode} proof outage setup did not mint two independent Sign tokens`);
    if (outageMode === 'throw') {
      combinedProofStore.setFailRemovePrefix('mlsAthenaNoteWriteProofV1.');
      combinedProofStore.setFailSetPrefix('mlsAthenaNoteWriteProofV1.');
    } else {
      combinedProofStore.setDropRemovePrefix('mlsAthenaNoteWriteProofV1.');
      combinedProofStore.setDropSetPrefix('mlsAthenaNoteWriteProofV1.');
    }
    const combinedProofFailure = await combinedProofWorker.send(executeMessageFor(
      combinedSignMessage, combinedFirstSign, { gestureProof: `proof-combined-first-${outageMode}` }
    ));
    assert.strictEqual(combinedProofFailure.reason, 'token-state-unavailable');
    assert.strictEqual(combinedProofWorker.executeCalls, 0,
      `${outageMode} combined proof outage reached the Athena driver`);
    assert.strictEqual(proofEntry(combinedProofStore, combinedWrite.noteWriteProof).record.state, 'ready',
      `${outageMode} combined proof outage fixture did not preserve the adversarial ready record`);
    assert(combinedProofStore.alarmNames.includes(`mls-athena-auth-quarantine-v1.proof.${combinedWrite.noteWriteProof}`),
      `${outageMode} combined proof outage did not retain its durable quarantine`);
    combinedProofStore.setFailRemovePrefix(''); combinedProofStore.setFailSetPrefix('');
    combinedProofStore.setDropRemovePrefix(''); combinedProofStore.setDropSetPrefix('');
    const combinedProofReplayWorker = makeWorker(combinedProofStore);
    const combinedProofReplay = await combinedProofReplayWorker.send(executeMessageFor(
      combinedSignMessage, combinedReplaySign, { gestureProof: `proof-combined-replay-${outageMode}` }
    ));
    assert.strictEqual(combinedProofReplay.reason, 'token-state-unavailable',
      `${outageMode} combined proof outage revived after worker recovery`);
    assert.strictEqual(combinedProofReplayWorker.executeCalls, 0,
      `${outageMode} combined proof outage replay reached the Athena driver`);
  }

  // If the exact proof cannot be persisted, the already-verified note result
  // remains truthful but must not expose an unusable Sign capability.
  const proofFailureStore = makeSessionStore();
  proofFailureStore.setFailSetPrefix('mlsAthenaNoteWriteProofV1.');
  const proofFailureWorker = makeWorker(proofFailureStore);
  const proofFailureProbe = await proofFailureWorker.send({ ...probeMessage, previewHash: 'preview-proof-store-failure' });
  const proofFailureWrite = await proofFailureWorker.send(executeMessage(proofFailureProbe, {
    previewHash: 'preview-proof-store-failure', gestureProof: 'proof-store-failure'
  }));
  assert.strictEqual(proofFailureWrite.ok, true, 'proof persistence failure rewrote an already verified note result');
  assert.strictEqual(proofFailureWrite.noteWriteProof, undefined,
    'an unpersisted verified-write proof was exposed as a usable Sign prerequisite');

  const proofSilentDropStore = makeSessionStore();
  proofSilentDropStore.setDropSetPrefix('mlsAthenaNoteWriteProofV1.');
  const proofSilentDropWorker = makeWorker(proofSilentDropStore);
  const proofSilentDropProbe = await proofSilentDropWorker.send({ ...probeMessage, previewHash: 'preview-proof-silent-drop' });
  const proofSilentDropWrite = await proofSilentDropWorker.send(executeMessage(proofSilentDropProbe, {
    previewHash: 'preview-proof-silent-drop', gestureProof: 'proof-silent-drop'
  }));
  assert.strictEqual(proofSilentDropWrite.ok, true);
  assert.strictEqual(proofSilentDropWrite.noteWriteProof, undefined,
    'a silently dropped verified-write proof survived its persistence readback');

  const expiredProofStore = makeSessionStore();
  const expiredProofWriter = makeWorker(expiredProofStore);
  const expiredProofProbe = await expiredProofWriter.send({ ...probeMessage, previewHash: 'preview-expired-proof' });
  const expiredProofWrite = await expiredProofWriter.send(executeMessage(expiredProofProbe, {
    previewHash: 'preview-expired-proof', gestureProof: 'expired-proof-write'
  }));
  const expiredProofRecord = proofEntry(expiredProofStore, expiredProofWrite.noteWriteProof).record;
  expiredProofRecord.issuedAt = Date.now() - 10000;
  expiredProofRecord.expiresAt = Date.now() - 1;
  const expiredProofSign = await makeWorker(expiredProofStore).send({
    ...probeMessage, action: 'sign_encounter', previewHash: 'preview-expired-proof',
    noteWriteProof: expiredProofWrite.noteWriteProof
  });
  assert.strictEqual(expiredProofSign.reason, 'note-write-proof-expired',
    'expired persisted write proof did not fail with its truthful prerequisite reason');

  // Optional signed-in account/practice expectations are part of the minted
  // authorization. Execute cannot weaken or replace what probe reviewed.
  const accountStore = makeSessionStore();
  const accountWorker = makeWorker(accountStore);
  const accountProbeMessage = {
    ...probeMessage, previewHash: 'preview-account-bound',
    expectedAccount: 'Example Clinician', expectedPracticeId: '22724'
  };
  const accountProbe = await accountWorker.send(accountProbeMessage);
  const missingAccount = await accountWorker.send(executeMessage(accountProbe, {
    previewHash: accountProbeMessage.previewHash,
    expectedAccount: '', expectedPracticeId: '22724', gestureProof: 'missing-account'
  }));
  assert.strictEqual(missingAccount.reason, 'account-mismatch',
    'execute could omit the account expectation that probe bound');
  assert.strictEqual(accountWorker.executeCalls, 0);

  const practiceProbe = await accountWorker.send({ ...accountProbeMessage, previewHash: 'preview-practice-bound' });
  const missingPractice = await accountWorker.send(executeMessage(practiceProbe, {
    previewHash: 'preview-practice-bound',
    expectedAccount: 'Example Clinician', expectedPracticeId: '', gestureProof: 'missing-practice'
  }));
  assert.strictEqual(missingPractice.reason, 'practice-mismatch',
    'execute could omit the practice expectation that probe bound');
  assert.strictEqual(accountWorker.executeCalls, 0);

  const boundProbe = await accountWorker.send({ ...accountProbeMessage, previewHash: 'preview-account-practice-success' });
  const boundSuccess = await accountWorker.send(executeMessage(boundProbe, {
    previewHash: 'preview-account-practice-success',
    expectedAccount: 'Example Clinician', expectedPracticeId: '22724', gestureProof: 'bound-success'
  }));
  assert.strictEqual(boundSuccess.ok, true, 'unchanged account/practice binding was rejected');
  assert.strictEqual(accountWorker.executeCalls, 1);

  // Two near-simultaneous clicks in one worker serialize their session claim.
  const doubleStore = makeSessionStore();
  const doubleProbe = await makeWorker(doubleStore).send(probeMessage);
  let releaseExecute;
  const holdExecute = new Promise(resolve => { releaseExecute = resolve; });
  const doubleWorker = makeWorker(doubleStore, { holdExecute });
  const a = doubleWorker.send(executeMessage(doubleProbe, { gestureProof: 'double-a' }));
  const b = doubleWorker.send(executeMessage(doubleProbe, { gestureProof: 'double-b' }));
  await new Promise(resolve => setImmediate(resolve));
  releaseExecute();
  const doubleResults = await Promise.all([a, b]);
  assert.strictEqual(doubleResults.filter(result => result.ok === true).length, 1,
    'double click executed zero or two mutations');
  assert.strictEqual(doubleResults.filter(result => result.reason === 'token-used').length, 1,
    'double click did not consume exactly one duplicate');
  assert.strictEqual(doubleWorker.executeCalls, 1, 'double click injected more than once');

  // Order-row replacement is one storage transaction: invalidate every older
  // same-manifest token and mint the newly reviewed row together.
  const orderStore = makeSessionStore();
  const orderWorker = makeWorker(orderStore, {
    executeResult(request) {
      return request.action === 'place_order'
        ? { ok: true, attempted: true, verified: true, orderPlaced: true, alreadyPresent: false, reason: 'one-exact-order-isolated-readback-verified', context: clone(lockedContext) }
        : null;
    }
  });
  const orderA = orderProbeMessage('local-order-atomic-a', 'row-order-atomic-a');
  const orderB = orderProbeMessage('local-order-atomic-b', 'row-order-atomic-b');
  const orderProbeA = await orderWorker.send(orderA);
  const orderProbeB = await orderWorker.send(orderB);
  assert(orderProbeA.ok && orderProbeB.ok, 'sequential exact-order probes were not minted');
  assert.strictEqual(tokenEntry(orderStore, orderProbeA.actionToken).record.state, 'invalidated',
    'new order probe left its older same-manifest token ready');
  assertRedactedTerminal(tokenEntry(orderStore, orderProbeA.actionToken).record,
    'invalidated order token');
  assert.strictEqual(tokenEntry(orderStore, orderProbeB.actionToken).record.state, 'ready');
  assert(orderStore.setHistory.some(keys => keys.includes(`mlsAthenaActionV3Token.${orderProbeA.actionToken}`) &&
    keys.includes(`mlsAthenaActionV3Token.${orderProbeB.actionToken}`)),
  'order invalidation and replacement mint were not committed in one session write');
  const staleOrder = await orderWorker.send(executeMessageFor(orderA, orderProbeA, {
    gestureProof: 'stale-order', gestureRowHash: orderA.rowHash, gestureClientOrderId: orderA.clientOrderId
  }));
  assert.strictEqual(staleOrder.reason, 'token-used');
  const liveOrder = await orderWorker.send(executeMessageFor(orderB, orderProbeB, {
    gestureProof: 'live-order', gestureRowHash: orderB.rowHash, gestureClientOrderId: orderB.clientOrderId
  }));
  assert.strictEqual(liveOrder.ok, true);
  assert.strictEqual(orderWorker.executeCalls, 1, 'atomic order replacement executed zero or two rows');

  const failedOrderStore = makeSessionStore();
  const failedOrderWorker = makeWorker(failedOrderStore);
  const retainedOrder = orderProbeMessage('local-order-retained', 'row-order-retained', 'preview-order-failed-transaction');
  const refusedReplacement = orderProbeMessage('local-order-refused', 'row-order-refused', 'preview-order-failed-transaction');
  const retainedProbe = await failedOrderWorker.send(retainedOrder);
  failedOrderStore.setDropBatchSet(true);
  const refusedProbe = await failedOrderWorker.send(refusedReplacement);
  assert.strictEqual(refusedProbe.reason, 'token-state-unavailable',
    'silently dropped order transaction returned an uncommitted replacement token');
  const readyAfterFailure = Object.entries(failedOrderStore.values).filter(([key, value]) =>
    key.startsWith('mlsAthenaActionV3Token.') && value.state === 'ready');
  assert.strictEqual(readyAfterFailure.length, 1,
    'failed replacement storage transaction left zero or multiple persisted ready order tokens');
  assert.strictEqual(readyAfterFailure[0][0], `mlsAthenaActionV3Token.${retainedProbe.actionToken}`,
    'failed replacement transaction displaced the last successfully returned order token');
  failedOrderStore.setDropBatchSet(false);
  const retainedAfterFailure = await failedOrderWorker.send(executeMessageFor(retainedOrder, retainedProbe, {
    gestureProof: 'retained-after-failed-replacement',
    gestureRowHash: retainedOrder.rowHash, gestureClientOrderId: retainedOrder.clientOrderId
  }));
  assert.strictEqual(retainedAfterFailure.ok, true,
    'failed replacement transaction changed the prior token only in the current worker');
  assert.strictEqual(failedOrderWorker.executeCalls, 1,
    'failed replacement transaction did not preserve exactly one executable prior order token');

  // Persisted state that was changed, expired, issued in the future, or left
  // at the mutation boundary never reaches the driver in a new worker.
  async function probeAndMutate(mutator) {
    const store = makeSessionStore();
    const probe = await makeWorker(store).send(probeMessage);
    const entry = onlyTokenEntry(store);
    mutator(entry.record);
    return { store, probe };
  }

  const tamperedFixture = await probeAndMutate(record => { record.locked.provider = 'Different Doctor'; });
  const tamperedWorker = makeWorker(tamperedFixture.store);
  const tampered = await tamperedWorker.send(executeMessage(tamperedFixture.probe));
  assert.strictEqual(tampered.reason, 'token-expired', 'tampered hydrated record was accepted');
  assert.strictEqual(tamperedWorker.executeCalls, 0);

  const expiredFixture = await probeAndMutate(record => { record.expiresAt = Date.now() - 1; });
  const expiredWorker = makeWorker(expiredFixture.store);
  const expired = await expiredWorker.send(executeMessage(expiredFixture.probe));
  assert.strictEqual(expired.reason, 'token-expired');
  assert.strictEqual(expiredWorker.executeCalls, 0);

  const pruneStore = makeSessionStore();
  const pruneWorker = makeWorker(pruneStore);
  const abandonedProbe = await pruneWorker.send({ ...probeMessage, previewHash: 'preview-abandoned-token' });
  const abandonedEntry = tokenEntry(pruneStore, abandonedProbe.actionToken);
  abandonedEntry.record.issuedAt = Date.now() - 10000;
  abandonedEntry.record.expiresAt = Date.now() - 1;
  const replacementProbe = await makeWorker(pruneStore).send({ ...probeMessage, previewHash: 'preview-prune-trigger' });
  assert(replacementProbe.ok, 'a stale abandoned token blocked a later exact probe');
  assert.strictEqual(pruneStore.values[abandonedEntry.key], undefined,
    'expired full-payload authorization was retained after the next session cleanup');

  const alarmStore = makeSessionStore();
  const alarmProbe = await makeWorker(alarmStore).send({ ...probeMessage, previewHash: 'preview-alarm-cleanup' });
  const alarmEntry = tokenEntry(alarmStore, alarmProbe.actionToken);
  alarmEntry.record.issuedAt = Date.now() - 10000;
  alarmEntry.record.expiresAt = Date.now() - 1;
  await alarmStore.fireAlarm();
  assert.strictEqual(alarmStore.values[alarmEntry.key], undefined,
    'expiry alarm retained abandoned full-payload authorization');

  const futureFixture = await probeAndMutate(record => {
    record.issuedAt = Date.now() + 60000;
    record.expiresAt = record.issuedAt + 60000;
  });
  const futureWorker = makeWorker(futureFixture.store);
  const future = await futureWorker.send(executeMessage(futureFixture.probe));
  assert.strictEqual(future.reason, 'token-expired', 'future-issued hydrated record was accepted');
  assert.strictEqual(futureWorker.executeCalls, 0);

  const uncertainFixture = await probeAndMutate(record => {
    record.used = true;
    record.state = 'executing';
    record.stateAt = Date.now();
  });
  const uncertainWorker = makeWorker(uncertainFixture.store);
  const uncertain = await uncertainWorker.send(executeMessage(uncertainFixture.probe));
  assert.strictEqual(uncertain.reason, 'outcome-uncertain',
    'worker restart at the mutation boundary did not halt as uncertain');
  assert.strictEqual(uncertainWorker.executeCalls, 0);

  // A rejected terminal write during the action-token claim must still erase
  // the ready authorization. Storage recovery plus worker restart may not turn
  // the caller's token-state-unavailable response into a later mutation.
  const claimFailureStore = makeSessionStore();
  const claimFailureWorker = makeWorker(claimFailureStore);
  const claimFailureProbe = await claimFailureWorker.send({ ...probeMessage, previewHash: 'preview-claim-failure' });
  claimFailureStore.setFailSet(true);
  const failedClaim = await claimFailureWorker.send(executeMessage(claimFailureProbe, {
    previewHash: 'preview-claim-failure', gestureProof: 'failed-action-terminal-write'
  }));
  assert.strictEqual(failedClaim.reason, 'token-state-unavailable');
  assert.strictEqual(claimFailureWorker.executeCalls, 0,
    'failed action-token claim persistence reached the Athena driver');
  assert.strictEqual(claimFailureStore.values[`mlsAthenaActionV3Token.${claimFailureProbe.actionToken}`], undefined,
    'failed action-token claim persistence left the ready authorization recoverable');
  claimFailureStore.setFailSet(false);
  const claimReplayWorker = makeWorker(claimFailureStore);
  const failedClaimReplay = await claimReplayWorker.send(executeMessage(claimFailureProbe, {
    previewHash: 'preview-claim-failure', gestureProof: 'claim-replay-after-restart'
  }));
  assert.strictEqual(failedClaimReplay.reason, 'token-expired',
    'failed action-token claim persistence revived a ready token after worker restart');
  assert.strictEqual(claimReplayWorker.executeCalls, 0,
    'replayed action token after failed claim persistence reached the Athena driver');

  for (const outageMode of ['throw', 'silent-drop']) {
    const combinedActionStore = makeSessionStore();
    const combinedActionWorker = makeWorker(combinedActionStore);
    const combinedActionProbe = await combinedActionWorker.send({
      ...probeMessage, previewHash: `preview-action-combined-${outageMode}`
    });
    if (outageMode === 'throw') {
      combinedActionStore.setFailRemove(true); combinedActionStore.setFailSet(true);
    } else {
      combinedActionStore.setDropRemove(true); combinedActionStore.setDropSet(true);
    }
    const combinedActionFailure = await combinedActionWorker.send(executeMessage(combinedActionProbe, {
      previewHash: `preview-action-combined-${outageMode}`, gestureProof: `action-combined-first-${outageMode}`
    }));
    assert.strictEqual(combinedActionFailure.reason, 'token-state-unavailable');
    assert.strictEqual(combinedActionWorker.executeCalls, 0,
      `${outageMode} combined action-token outage reached the Athena driver`);
    assert.strictEqual(tokenEntry(combinedActionStore, combinedActionProbe.actionToken).record.state, 'ready',
      `${outageMode} combined action-token outage fixture did not preserve the adversarial ready record`);
    assert(combinedActionStore.alarmNames.includes(`mls-athena-auth-quarantine-v1.token.${combinedActionProbe.actionToken}`),
      `${outageMode} combined action-token outage did not retain its durable quarantine`);
    combinedActionStore.setFailRemove(false); combinedActionStore.setFailSet(false);
    combinedActionStore.setDropRemove(false); combinedActionStore.setDropSet(false);
    const combinedActionReplayWorker = makeWorker(combinedActionStore);
    const combinedActionReplay = await combinedActionReplayWorker.send(executeMessage(combinedActionProbe, {
      previewHash: `preview-action-combined-${outageMode}`, gestureProof: `action-combined-replay-${outageMode}`
    }));
    assert.strictEqual(combinedActionReplay.reason, 'token-state-unavailable',
      `${outageMode} combined action-token outage revived after worker recovery`);
    assert.strictEqual(combinedActionReplayWorker.executeCalls, 0,
      `${outageMode} combined action-token outage replay reached the Athena driver`);
  }

  // Browser-session persistence is load-bearing. If Chrome refuses the write,
  // probe must fail closed instead of returning a token that dies on review.
  const failingStore = makeSessionStore();
  failingStore.setFailSet(true);
  const persistenceFailure = await makeWorker(failingStore).send(probeMessage);
  assert.strictEqual(persistenceFailure.reason, 'token-state-unavailable');
  assert.strictEqual(persistenceFailure.ok, false);
  assert.strictEqual(Object.keys(failingStore.values).length, 0);

  const silentDropStore = makeSessionStore();
  silentDropStore.setDropSet(true);
  const silentDrop = await makeWorker(silentDropStore).send(probeMessage);
  assert.strictEqual(silentDrop.reason, 'token-state-unavailable',
    'probe trusted a session write that did not survive readback');
  assert.strictEqual(silentDrop.ok, false);

  console.log('PASS Athena action token session runtime: exact action + Sign-proof restart, one-use replay/double-click/proof claims, combined remove+set outage quarantine, atomic order replacement, exact binding/tamper/expiry, uncertain restart, storage failure/readback, PHI-free terminal tombstones, and expiry cleanup');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
