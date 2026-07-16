"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const COLLECTOR_PATH = path.join(__dirname, "phi-free-live-pull-acceptance-collector.js");
const COLLECTOR_SOURCE = fs.readFileSync(COLLECTOR_PATH, "utf8");
const TARGET_DATE = "2026-07-15";
const CARD_KEYS = ["problems", "meds", "allergies", "summary", "vitals", "history"];
const BUILD = Object.freeze({
  importerVersion: "si-1.7.4",
  extensionVersion: "2.9.25",
  assetVersion: "b320",
  importerSha256: "a".repeat(64),
  extensionSha256: "b".repeat(64),
  assetSha256: "c".repeat(64)
});

function profileCoverage(patientId, requestId, now) {
  const cards = {};
  CARD_KEYS.forEach(key => {
    cards[key] = { status: "found", populated: true };
  });
  return {
    complete: true,
    exactIdentityVerified: true,
    patientId,
    saveRequestId: requestId + "-parse",
    capturedAt: now,
    cards
  };
}

function makeOpNoteApi(getPatient, config) {
  const api = { lastInjectionReceipt: null };
  const contextText = [
    "=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===",
    "PRIOR LONGITUDINAL HISTORY",
    "Verified read-only history body with enough detail to prove that the exact-patient context was built and injected.",
    "=== MLS VERIFIED EXACT-PATIENT CONTEXT END ==="
  ].join("\n");

  function buildHistoryContext(_name, opts) {
    const patient = getPatient();
    const visitCount = Array.isArray(patient && patient.visits) ? patient.visits.length : 0;
    return {
      ok: true,
      patientId: String(opts && opts.patientId || ""),
      patientDob: String(patient && patient.dob || ""),
      visitCount,
      snapshotIncluded: true,
      text: contextText
    };
  }

  function validateBinding(opts) {
    const binding = opts && opts.mlsVerifiedHistoryBinding;
    return { ok: !!(binding && binding.token && binding.patientId) };
  }

  function injectIfOpNote(_sys, user, opts) {
    const patient = getPatient();
    const phase = opts && opts.mlsOpNotePhase === "repair" ? "repair" : "initial";
    let binding = opts && opts.mlsVerifiedHistoryBinding;
    if (!binding) {
      const nextBinding = {
        patientId: String(opts && opts.mlsOpNotePatientId || ""),
        patientDob: String(patient && patient.dob || ""),
        procedure: "Read-only acceptance context check",
        token: "frozen-context-token"
      };
      binding = config.mutableOpNoteBinding === true ? nextBinding : Object.freeze(nextBinding);
      opts.mlsVerifiedHistoryBinding = binding;
    } else if (phase === "repair" && config.replaceRepairBinding === true) {
      binding = Object.freeze(Object.assign({}, binding));
      opts.mlsVerifiedHistoryBinding = binding;
    }
    api.lastInjectionReceipt = {
      included: true,
      identityVerified: true,
      phase,
      at: Date.now(),
      visitCount: Array.isArray(patient && patient.visits) ? patient.visits.length : 0,
      snapshotIncluded: true,
      historyChars: contextText.length,
      contextToken: binding.token
    };
    const text = String(user || "");
    const anchor = text.indexOf("SELECTED TEMPLATE");
    const injectedContext = config.omitInjectedEnd === true
      ? contextText.replace("=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===", "")
      : contextText;
    if (anchor < 0) return text + "\n\n" + injectedContext;
    return text.slice(0, anchor) + injectedContext + "\n\n" + text.slice(anchor);
  }

  api.validateBinding = validateBinding;
  api._internal = {
    getVisitsFor(patient) { return Array.isArray(patient && patient.visits) ? patient.visits : []; },
    visitMatchesPatient(patient, visit) {
      return String(patient && patient.id || "") === String(visit && visit.identityBinding || "");
    },
    buildHistoryContext,
    injectIfOpNote
  };
  return api;
}

function makeRun(runNumber, config, options) {
  const now = Date.now();
  const patientId = "patient-1";
  const providerOption = options && options.provider && typeof options.provider === "object" ? options.provider : null;
  const requestedProviderId = String(providerOption && providerOption.id || "");
  const requestedProviderStableKey = String(providerOption && (providerOption.stableKey || providerOption.stable_key) || "");
  const providerMode = requestedProviderId || requestedProviderStableKey ? "selected" : "all";
  const pullRequestId = "schedule-pull-" + now.toString(36) + "-" + runNumber.toString(36);
  const batchRequestId = "history-batch-" + now.toString(36) + "-" + runNumber.toString(36);
  const patientRequestId = batchRequestId + "-p1";
  const alias = typeof config.aliasForRun === "function"
    ? String(config.aliasForRun(runNumber)) : "encounter-a";
  const removed = typeof config.removedForRun === "function"
    ? Number(config.removedForRun(runNumber)) : 0;
  const receiptCoverage = profileCoverage(patientId, patientRequestId, now);
  const localCoverage = JSON.parse(JSON.stringify(receiptCoverage));
  const visit = {
    source: "athena",
    identityVerified: true,
    identityBinding: patientId,
    indexOnly: false,
    fullDetail: true,
    bodyComplete: true,
    raw: "Verified longitudinal clinical visit content for the exact patient.",
    encounterId: alias
  };
  const patient = {
    id: patientId,
    name: "Acceptance Patient",
    dob: "01/01/1970",
    problems: "verified problem",
    meds: "verified medication",
    allergies: "verified allergy",
    summary: "verified summary",
    vitals: { value: "verified vitals" },
    history: "verified history",
    visits: [visit],
    athenaProfileCoverage: localCoverage,
    athenaChartSnapshot: {
      capturedAt: now,
      pulledAt: now,
      problems: ["verified problem"],
      meds: ["verified medication"],
      allergies: ["verified allergy"],
      summary: "verified summary",
      vitals: { value: "verified vitals" },
      history: "verified history"
    }
  };
  const patientReceipt = {
    patientId,
    requestId: patientRequestId,
    identityVerified: true,
    identityProof: "dob",
    dobVerified: true,
    complete: true,
    organized: true,
    organizationComplete: true,
    visitsComplete: true,
    visitsCoverageComplete: true,
    authoritativeEmpty: false,
    expectedVisits: 1,
    parsedVisits: 1,
    persistedVisits: 1,
    visitsReaderVersion: "2.9.22-visits-r4-two-stage",
    profileCoverageFresh: true,
    profileCoverage: receiptCoverage,
    chartCoverage: {
      kind: "athena-chart-coverage",
      complete: true,
      readerVersion: "2.9.19-chart-r3",
      identityObserved: true,
      requestId: patientRequestId + "-chart",
      expectedClinicalFrames: 1,
      readClinicalFrames: 1,
      boundClinicalFrames: 1,
      unboundClinicalFrames: 0,
      oversizeClinicalFrames: 0,
      unreadFrames: 0,
      omittedForCap: 0,
      truncated: false,
      textChars: 512,
      capturedAt: now
    },
    reconcileReceipt: { complete: true, removed }
  };
  const result = {
    ok: true,
    complete: true,
    includeHistory: true,
    target: TARGET_DATE,
    scheduleVerified: true,
    created: runNumber === 1 ? 1 : 0,
    repaired: runNumber === 1 ? 0 : 1,
    skipped: 0,
    failed: 0,
    scheduleReceipt: {
      complete: true,
      expectedCount: 1,
      candidateCount: 1,
      parsedCount: 1,
      mergedRows: 1,
      unnamedCount: 0,
      viewportCoverageComplete: true,
      authoritativeEmpty: false,
      declaredCount: 1,
      countStrategy: "single-provider-declared-total",
      declaredCountAuthoritative: true,
      declaredCountReason: "single-provider-surface-total",
      requestId: pullRequestId
    },
    providerReceipt: {
      mode: providerMode,
      complete: true,
      scheduleComplete: true,
      sourceRows: 1,
      providerTaggedRows: 1,
      matchingRows: providerMode === "selected" ? 1 : 0,
      mismatchedRows: 0,
      unattributedRows: 0,
      rosterVerified: providerMode === "selected",
      requestedId: requestedProviderId,
      requestedStableKey: requestedProviderStableKey
    },
    providerRosterReceipt: {
      complete: true,
      partial: false,
      reason: "complete",
      expectedCount: 1,
      observedCount: 1,
      reachedEnd: true,
      capReached: false,
      budgetExpired: false,
      restored: true,
      boundsStable: true,
      steps: 1,
      updatedAt: now,
      listedCount: 1,
      identityKeys: [requestedProviderStableKey || (requestedProviderId ? "athena-id:" + requestedProviderId : "athena-id:provider-1")],
      targetDate: TARGET_DATE,
      requestId: pullRequestId,
      providerMode,
      requestedProviderId,
      requestedProviderStableKey
    },
    resolvedAppointments: [{ sourceIdentity: "source-1", backendAppointmentId: "backend-1", patientId, date: TARGET_DATE }],
    historyTargets: [{
      _mlsTargetPatientId: patientId,
      _mlsTargetDob: "01/01/1970",
      dob: "01/01/1970",
      date: TARGET_DATE,
      scheduleDate: TARGET_DATE
    }],
    historyUnresolved: [],
    identityBootstrapReceipt: {
      complete: true, attempted: 1, alreadyProven: 0, requested: 1,
      resolved: 1, failed: 0, appointmentBound: 1, reasons: {},
      batchToken: now.toString(36),
      proofs: [{
        requestId: "schedule-proof-" + now.toString(36) + "-p1",
        scheduleDate: TARGET_DATE,
        appointmentIdBound: true, navigationProven: true, exactNameMatched: true,
        bannerIdentity: true, dobVerified: true, requestBound: true
      }]
    },
    calendarReceipt: {
      complete: true,
      attempted: 1,
      accounted: 1,
      mapped: 1,
      uniqueSources: 1,
      uniqueBackend: 1,
      mappingComplete: true,
      unresolvedMappings: 0,
      created: runNumber === 1 ? 1 : 0,
      repaired: runNumber === 1 ? 0 : 1,
      skipped: 0,
      failed: 0,
      wrongDay: 0,
      invalidDate: 0,
      snapshotPublished: true
    },
    historyReceipt: {
      complete: true,
      exactIdentityVerified: true,
      requestId: batchRequestId,
      timedOut: false,
      startedAt: now,
      requested: 1,
      processed: 1,
      failures: 0,
      retry: [],
      patients: [patientReceipt]
    }
  };
  if (config.emptyDay === true) {
    Object.assign(result, { created: 0, repaired: 0, skipped: 0 });
    Object.assign(result.scheduleReceipt, {
      expectedCount: 0, candidateCount: 0, parsedCount: 0, mergedRows: 0,
      authoritativeEmpty: true, declaredCount: 0,
      countStrategy: "verified-viewport-candidates", declaredCountAuthoritative: false,
      declaredCountReason: "no-authoritative-declared-total"
    });
    Object.assign(result.providerReceipt, { sourceRows: 0, providerTaggedRows: 0, matchingRows: 0, mismatchedRows: 0 });
    result.resolvedAppointments = [];
    result.historyTargets = [];
    Object.assign(result.identityBootstrapReceipt, {
      attempted: 0, alreadyProven: 0, requested: 0, resolved: 0, failed: 0, appointmentBound: 0, proofs: []
    });
    Object.assign(result.calendarReceipt, {
      attempted: 0, accounted: 0, mapped: 0, uniqueSources: 0, uniqueBackend: 0,
      created: 0, repaired: 0, skipped: 0
    });
    Object.assign(result.historyReceipt, { requested: 0, processed: 0, patients: [] });
  }
  if (config.countProvenance && typeof config.countProvenance === "object") {
    Object.assign(result.scheduleReceipt, config.countProvenance);
  }
  if (typeof config.mutateRun === "function") config.mutateRun({ result, patient, runNumber });
  return { result, patient: config.emptyDay === true ? null : patient };
}

function makeDocument(config) {
  const nodes = Object.create(null);
  const selectors = Object.create(null);
  function node(id, parent) {
    const attributes = Object.create(null);
    const value = {
      id: id || "",
      hidden: false,
      textContent: "",
      style: { display: "", visibility: "" },
      parentNode: parent || null,
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
      setAttribute(name, value) { attributes[name] = String(value); },
      contains(candidate) {
        let current = candidate;
        while (current) {
          if (current === value) return true;
          current = current.parentNode;
        }
        return false;
      }
    };
    if (id) nodes[id] = value;
    return value;
  }
  const root = {
    appendChild(node) {
      if (node && node.id) nodes[node.id] = node;
      return node;
    }
  };
  const profile = node("profileCard", root);
  const profName = node("profName", profile);
  const cardNodes = {
    problems: node("profProblems", profile),
    meds: node("profMeds", profile),
    allergies: node("profAllergies", profile),
    summary: node("profSummary", profile),
    vitals: node("mlsEpVitalsBody", profile),
    history: node("mlsEpHistoryBody", profile)
  };
  selectors["#profProblems"] = cardNodes.problems;
  selectors["#profMeds"] = cardNodes.meds;
  selectors["#profAllergies"] = cardNodes.allergies;
  selectors["#profSummary"] = cardNodes.summary;
  selectors["#mlsEpVitalsBox .body"] = cardNodes.vitals;
  selectors["#mlsEpHistoryBox .body"] = cardNodes.history;
  const document = {
    documentElement: root,
    body: root,
    getElementById(id) { return nodes[id] || null; },
    querySelector(selector) {
      if (config.missingDomCard && selector === ({
        problems: "#profProblems", meds: "#profMeds", allergies: "#profAllergies", summary: "#profSummary",
        vitals: "#mlsEpVitalsBox .body", history: "#mlsEpHistoryBox .body"
      })[config.missingDomCard]) return null;
      return selectors[selector] || null;
    },
    createElement() { return node("", null); },
    __renderPatient(patient) {
      profName.textContent = config.wrongDomPatient === true ? "Wrong Patient" : String(patient && patient.name || "");
      const coverage = patient && patient.athenaProfileCoverage || {};
      const snapshot = patient && patient.athenaChartSnapshot || {};
      const values = {
        problems: patient && patient.problems,
        meds: patient && (patient.meds || patient.medications),
        allergies: patient && patient.allergies,
        summary: patient && patient.summary,
        vitals: snapshot.vitals && snapshot.vitals.value || patient && patient.vitals && patient.vitals.value,
        history: snapshot.history || patient && patient.history
      };
      CARD_KEYS.forEach(key => {
        const card = coverage.cards && coverage.cards[key] || {};
        cardNodes[key].textContent = card.status === "not_documented"
          ? "No " + key + " documented in Athena."
          : String(values[key] == null ? "" : values[key]);
      });
      if (typeof config.mutateDom === "function") config.mutateDom({ nodes: cardNodes, profName, patient });
    }
  };
  return document;
}

function createHarness(config) {
  config = config || {};
  let runNumber = 0;
  let currentPatient = config.startWithoutLocalPatient === true || config.emptyDay === true ? null : {
    id: "patient-1",
    name: "Acceptance Patient",
    dob: "01/01/1970",
    problems: config.prePullProblem || "verified problem",
    meds: "verified medication",
    allergies: "verified allergy",
    summary: "verified summary",
    vitals: { value: "verified vitals" },
    history: "verified history",
    athenaChartSnapshot: {
      problems: [config.prePullProblem || "verified problem"],
      meds: ["verified medication"],
      allergies: ["verified allergy"],
      summary: "verified summary",
      vitals: { value: "verified vitals" },
      history: "verified history"
    },
    visits: [{
      source: "athena",
      identityVerified: true,
      identityBinding: "patient-1",
      indexOnly: false,
      fullDetail: true,
      bodyComplete: true,
      raw: "Previously verified exact-patient history used only for pre-pull reconciliation evidence.",
      encounterId: "encounter-a"
    }]
  };
  let currentRoster = null;
  let activePatientId = currentPatient ? currentPatient.id : "";
  const document = makeDocument(config);
  const listeners = Object.create(null);
  const window = {
    __mlsPhiFreeAcceptanceExpectedDate: TARGET_DATE,
    __mlsPhiFreeAcceptanceExpectedBuild: Object.assign({}, BUILD),
    __mlsExtReportedVersion: "2.9.25",
    __MLS_AV: "b320",
    addEventListener(type, listener) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] || []).filter(item => item !== listener);
    },
    postMessage(data) {
      const emit = payload => (listeners.message || []).slice().forEach(listener => listener({ source: window, data: payload }));
      emit(data);
      if (data && data.source === "mls-app" && data.type === "mlsPing" && config.missingExtensionBuildMessage !== true) {
        const digest = config.extensionBuildDigest || BUILD.extensionSha256;
        emit({
          source: "mls-ext", type: "mlsPong",
          version: config.extensionBuildVersion || BUILD.extensionVersion,
          buildId: "core-sha256:" + digest
        });
      }
    },
    getComputedStyle(node) { return node && node.style || { display: "", visibility: "" }; },
    getPatients() { return currentPatient ? [currentPatient] : []; },
    getActivePtId() { return activePatientId; },
    setActivePtId(id) { activePatientId = String(id || ""); },
    renderProfile() {
      if (currentPatient && activePatientId === String(currentPatient.id || "")) document.__renderPatient(currentPatient);
    },
    __mlsVisitModel: {
      getVisits(patient) { return Array.isArray(patient && patient.visits) ? patient.visits : []; }
    }
  };
  window.__mlsOpNoteHistory = makeOpNoteApi(() => currentPatient, config);
  window.__mlsProviderRoster = {
    getReceipt() { return currentRoster; }
  };
  function makeMonthDayReceipt(day, index, options) {
    const now = Date.now();
    const providerOption = options && options.provider && typeof options.provider === "object" ? options.provider : null;
    const requestedProviderId = String(providerOption && providerOption.id || "");
    const requestedProviderStableKey = String(providerOption && (providerOption.stableKey || providerOption.stable_key) || "");
    const providerMode = requestedProviderId || requestedProviderStableKey ? "selected" : "all";
    const scheduleRequestId = "mlssi-sched-month-" + now.toString(36) + "-d" + (index + 1);
    const rows = index % 3 === 0 ? 0 : 1; /* mixture of verified-empty and one-patient days */
    return {
      date: day, ok: true, complete: true, reason: rows ? "complete" : "empty-day",
      receipt: {
        ok: true, complete: true, includeHistory: true, target: day,
        created: rows, repaired: 0, skipped: 0, failed: 0,
        scheduleReceipt: { complete: true, authoritativeEmpty: rows === 0, requestId: scheduleRequestId, expectedCount: rows, parsedCount: rows },
        providerRosterReceipt: {
          complete: true, partial: false, reason: "complete", observedCount: 1,
          reachedEnd: true, capReached: false, budgetExpired: false, restored: true, boundsStable: true,
          updatedAt: now, targetDate: day, requestId: scheduleRequestId, providerMode,
          requestedProviderId: providerMode === "selected" ? requestedProviderId : "",
          requestedProviderStableKey: providerMode === "selected" ? requestedProviderStableKey : ""
        },
        calendarReceipt: { complete: true, attempted: rows, accounted: rows, failed: 0 },
        identityBootstrapReceipt: {
          complete: true, attempted: rows, alreadyProven: rows, requested: 0, resolved: 0,
          failed: 0, appointmentBound: 0, reasons: {}, batchToken: now.toString(36), proofs: []
        },
        historyReceipt: { complete: true, exactIdentityVerified: true, requested: rows, processed: rows, failures: 0, retry: [], patients: [] }
      }
    };
  }
  function makeMonthResult(options) {
    const month = String(options && options.month || "2026-07");
    const match = month.match(/^(\d{4})-(\d{2})$/);
    const days = [];
    if (match) {
      const cursor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
      while (cursor.getUTCMonth() === Number(match[2]) - 1) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    const dayEntries = days.map((day, index) => makeMonthDayReceipt(day, index, options || {}));
    const totals = {
      days: days.length, completeDays: dayEntries.length, failures: 0,
      scheduleAttempted: 0, scheduleAccounted: 0, created: 0, repaired: 0, skipped: 0,
      historiesRequested: 0, historiesProcessed: 0
    };
    dayEntries.forEach(entry => {
      const receipt = entry.receipt;
      totals.scheduleAttempted += receipt.calendarReceipt.attempted;
      totals.scheduleAccounted += receipt.calendarReceipt.accounted;
      totals.created += receipt.created; totals.repaired += receipt.repaired; totals.skipped += receipt.skipped;
      totals.historiesRequested += receipt.historyReceipt.requested;
      totals.historiesProcessed += receipt.historyReceipt.processed;
    });
    const result = {
      ok: true, complete: true, reason: "complete", month, includeHistory: true,
      days: dayEntries, totals, retry: { dates: [] }
    };
    if (typeof config.mutateMonth === "function") config.mutateMonth(result);
    return result;
  }
  window.__mlsSI = {
    version: "si-1.7.4",
    authoritativeStatusForDay() {
      const count = config.emptyDay === true ? 0 : Number(config.canonicalCount || 1);
      return { available: true, exact: true, sourceCount: count, activeCount: count, missingCount: 0, unclassifiedCount: 0 };
    },
    pull(options) {
      runNumber++;
      const built = makeRun(runNumber, config, options || {});
      currentPatient = built.patient;
      if (!activePatientId && currentPatient) activePatientId = currentPatient.id;
      currentRoster = built.result.providerRosterReceipt;
      window.__mlsPhiFreeAcceptanceObservedBuild = Object.assign({}, BUILD, { capturedAt: Date.now() });
      if (config.missingBuildEvidence === true) delete window.__mlsPhiFreeAcceptanceObservedBuild;
      if (typeof config.mutateObservedBuild === "function") config.mutateObservedBuild(window.__mlsPhiFreeAcceptanceObservedBuild);
      return Promise.resolve(built.result);
    },
    pullMonth(options) {
      return Promise.resolve(makeMonthResult(options || {}));
    }
  };
  if (typeof config.mutateWindow === "function") config.mutateWindow(window);
  window.window = window;
  window.document = document;
  const context = vm.createContext({ window, document, console, Promise, Date, setTimeout, clearTimeout });
  vm.runInContext(COLLECTOR_SOURCE, context, { filename: COLLECTOR_PATH });
  return {
    window,
    async pull(options) {
      return window.__mlsSI.pull(Object.assign({ date: TARGET_DATE, includeHistory: true }, options || {}));
    },
    async pullMonth(options) { return window.__mlsSI.pullMonth(Object.assign({ month: "2026-07", includeHistory: true }, options || {})); },
    latest() { return window.__mlsPhiFreeAcceptance.latest(); },
    monthResults() { return window.__mlsPhiFreeAcceptance.monthResults(); },
    verdict() { return window.__mlsPhiFreeAcceptance.verdict(); }
  };
}

module.exports = { TARGET_DATE, createHarness };
