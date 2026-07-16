/*
 * PHI-free live acceptance collector for the exact MLS schedule/history pull.
 *
 * Install this IIFE in the MLS page's MAIN world before an explicit pull. It
 * wraps window.__mlsSI.pull without changing its arguments, return value,
 * callbacks, or error behavior. Only dates, counts, booleans, version strings,
 * and fixed reason categories are exposed. Patient identifiers remain private
 * inside this closure and raw Athena/app payloads are never retained.
 *
 *   window.__mlsPhiFreeAcceptance.status()
 *   window.__mlsPhiFreeAcceptance.latest()
 *   window.__mlsPhiFreeAcceptance.results()
 *   window.__mlsPhiFreeAcceptance.verdict()
 *
 * A hidden DOM mirror (#mlsPhiFreeAcceptanceReceipt) contains the same sanitized
 * JSON so an isolated browser automation world can monitor long pulls without
 * gaining access to page globals or PHI.
 */
(() => {
  "use strict";

  const COLLECTOR_VERSION = "phi-free-pull-acceptance-3.4.14";
  const R4_READER_VERSION = "2.9.22-visits-r4-two-stage";
  const CHART_READER_VERSION = "2.9.19-chart-r3";
  const EXPECTED_IMPORTER_VERSION = "si-1.7.2";
  const EXPECTED_EXTENSION_VERSION = "2.9.25";
  const EXPECTED_ASSET_VERSION = "b318";
  const MIN_VISIT_BODY_CHARS = 40;
  const RECEIPT_NODE_ID = "mlsPhiFreeAcceptanceReceipt";
  const CARD_KEYS = ["problems", "meds", "allergies", "summary", "vitals", "history"];
  const api = window.__mlsSI;
  const EXPECTED_TARGET_DATE = String(window.__mlsPhiFreeAcceptanceExpectedDate || "");
  const EXPECTED_BUILD = (() => {
    const source = window.__mlsPhiFreeAcceptanceExpectedBuild;
    if (!source || typeof source !== "object") return Object.freeze({});
    return Object.freeze({
      importerVersion: String(source.importerVersion || ""),
      extensionVersion: String(source.extensionVersion || ""),
      assetVersion: String(source.assetVersion || ""),
      importerSha256: String(source.importerSha256 || "").toLowerCase(),
      extensionSha256: String(source.extensionSha256 || "").toLowerCase(),
      assetSha256: String(source.assetSha256 || "").toLowerCase()
    });
  })();

  if (!api || typeof api.pull !== "function") {
    throw new Error("MLS exact schedule importer is not ready on this page.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(EXPECTED_TARGET_DATE)) {
    throw new Error("Set window.__mlsPhiFreeAcceptanceExpectedDate to the explicit YYYY-MM-DD target before installing the collector.");
  }
  if (api.pull.__mlsPhiFreeAcceptanceWrapped === true && window.__mlsPhiFreeAcceptance) {
    return window.__mlsPhiFreeAcceptance.status();
  }

  const originalPull = api.pull;
  const originalPullMonth = typeof api.pullMonth === "function" ? api.pullMonth : null;
  const records = [];
  let everRepeatFailed = false;
  let uncertifiedMonthObserved = false;
  let extensionBuildMessage = { version: "", buildId: "", digest: "", at: 0, type: "" };
  const hasOwn = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);
  const array = value => Array.isArray(value) ? value : [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const evidenceCount = (object, key) => {
    if (!hasOwn(object, key)) return null;
    const raw = object[key];
    return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
  };
  const capturedAt = value => {
    const numeric = Number(value || 0);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const oneMarker = (text, marker) => {
    const first = String(text || "").indexOf(marker);
    return first >= 0 && String(text || "").indexOf(marker, first + marker.length) < 0;
  };
  const sameStrings = (left, right) => {
    const a = array(left).slice().sort();
    const b = array(right).slice().sort();
    return a.length === b.length && a.every((value, index) => value === b[index]);
  };
  const nonblankUniqueStrings = values => {
    const seen = Object.create(null);
    return Array.isArray(values) && values.every(value => {
      const text = String(value || "").trim();
      if (!text || seen[text]) return false;
      seen[text] = true;
      return true;
    });
  };
  const sha256 = value => /^[a-f0-9]{64}$/.test(String(value || "").toLowerCase());
  const buildIdDigest = value => {
    const match = String(value || "").toLowerCase().match(/(?:^|[:+_\-])([a-f0-9]{64})$/);
    return match ? match[1] : "";
  };
  const onExtensionBuildMessage = event => {
    const data = event && event.data;
    if (!data || data.source !== "mls-ext" || (data.type !== "mlsPong" && data.type !== "mlsExtVersion")) return;
    const digest = buildIdDigest(data.buildId);
    if (!digest) return;
    extensionBuildMessage = {
      version: String(data.version || ""),
      buildId: String(data.buildId || ""),
      digest,
      at: Date.now(),
      type: String(data.type || "")
    };
  };
  try { window.addEventListener("message", onExtensionBuildMessage); } catch (_) {}
  const stringSubset = (left, right) => {
    const rightSet = Object.create(null);
    array(right).forEach(value => { rightSet[value] = true; });
    return array(left).every(value => rightSet[value] === true);
  };
  const hasSubstantiveData = value => {
    if (Array.isArray(value)) return value.some(hasSubstantiveData);
    if (value && typeof value === "object") return Object.keys(value).some(key => hasSubstantiveData(value[key]));
    return !!String(value == null ? "" : value).trim();
  };
  const normalizeDob = value => {
    const text = String(value || "").trim();
    if (!text) return "";
    let match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (match) {
      let year = match[3];
      if (year.length === 2) year = (Number(year) <= Number(String(new Date().getFullYear()).slice(-2)) ? "20" : "19") + year;
      return year + ("0" + match[1]).slice(-2) + ("0" + match[2]).slice(-2);
    }
    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) return match[1] + ("0" + match[2]).slice(-2) + ("0" + match[3]).slice(-2);
    return text.toLowerCase().replace(/[^a-z0-9]/g, "");
  };
  const validDob = value => {
    const normalized = normalizeDob(value);
    if (!/^\d{8}$/.test(normalized)) return "";
    const year = Number(normalized.slice(0, 4));
    const month = Number(normalized.slice(4, 6));
    const day = Number(normalized.slice(6, 8));
    if (year < 1900 || year > new Date().getFullYear() || month < 1 || month > 12 || day < 1 || day > 31) return "";
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || parsed.getTime() > Date.now()) return "";
    return normalized;
  };
  /* Exact normalized bodies stay only inside the closure-private repeat facts.
     A short non-cryptographic hash can collide and falsely bless a changed
     visit, while retaining the exact private string exposes nothing through
     status/latest/results/verdict or the DOM receipt. */
  const privateBodyProof = value => String(value || "").replace(/\s+/g, " ").trim();
  const contentLeaves = value => {
    if (Array.isArray(value)) return value.reduce((out, item) => out.concat(contentLeaves(item)), []);
    if (value && typeof value === "object") return Object.keys(value).reduce((out, key) => out.concat(contentLeaves(value[key])), []);
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim().toLowerCase();
    return text ? [text] : [];
  };
  const listFacts = value => {
    const out = [];
    const visit = item => {
      if (Array.isArray(item)) { item.forEach(visit); return; }
      if (item && typeof item === "object") { Object.keys(item).forEach(key => visit(item[key])); return; }
      String(item == null ? "" : item).split(/[\r\n;,]+/).forEach(part => {
        const fact = part.replace(/^\s*[\u2022\-*]+\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
        if (fact) out.push(fact);
      });
    };
    visit(value);
    return out;
  };
  const boundedPhrasePresent = (rendered, fact) => {
    const text = contentLeaves(rendered).join("\n");
    const escaped = String(fact || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !!escaped && new RegExp("(?:^|[^a-z0-9])" + escaped + "(?:$|[^a-z0-9])", "i").test(text);
  };
  const renderedHasFact = (rendered, fact, key) => {
    if (key === "problems" || key === "meds" || key === "allergies") return listFacts(rendered).indexOf(fact) >= 0;
    if (key === "summary") return boundedPhrasePresent(rendered, fact);
    return contentLeaves(rendered).indexOf(fact) >= 0;
  };
  const snapshotFactsFor = (snapshot, key) =>
    (key === "problems" || key === "meds" || key === "allergies") ? listFacts(snapshot) : contentLeaves(snapshot);
  const renderedIncludesSnapshot = (rendered, snapshot, key) => {
    const snapshotFacts = snapshotFactsFor(snapshot, key);
    return snapshotFacts.length > 0 && snapshotFacts.every(fact => renderedHasFact(rendered, fact, key));
  };
  const renderedExcludesSnapshot = (rendered, snapshot, key) => {
    const snapshotFacts = snapshotFactsFor(snapshot, key);
    return snapshotFacts.every(fact => !renderedHasFact(rendered, fact, key));
  };

  function reasonCategory(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return "none";
    const known = [
      "identity-target-unresolved", "chart-coverage-unproven", "chart-read-timeout",
      "chart-read-deadline-exceeded", "chart-parse-timeout", "chart-parse-deadline-exceeded",
      "clinical-field-coverage-unproven", "clinical-field-save-unproven",
      "chart-identity-save-refused", "bridge-deadline-exceeded", "visits-read-timeout",
      "visits-read-deadline-exceeded", "visits-full-detail-unproven",
      "visits-identity-proof-failed", "visits-count-mismatch", "visits-empty-unproven",
      "visits-source-key-unproven", "visit-row-identity-mismatch",
      "history-organization-unproven", "open-deadline-exceeded", "read-deadline-exceeded",
      "deferred-after-timeout", "extension-error", "open-failed", "chart-not-ready",
      "busy", "history-partial"
    ];
    for (const key of known) if (text.includes(key)) return key;
    if (/timeout|too long|deadline/.test(text)) return "other-deadline";
    if (/identity|wrong-chart|wrong patient/.test(text)) return "other-identity-refusal";
    if (/coverage|complete/.test(text)) return "other-coverage-refusal";
    return "other-fail-closed";
  }

  function currentRosterReceipt(result) {
    const attached = result && result.providerRosterReceipt;
    if (attached && typeof attached === "object") return attached;
    let live = null;
    try {
      const roster = window.__mlsProviderRoster;
      live = roster && typeof roster.getReceipt === "function" ? roster.getReceipt() : null;
    } catch (_) {}
    return live || {};
  }
  function liveRosterReceipt() {
    try {
      const roster = window.__mlsProviderRoster;
      return roster && typeof roster.getReceipt === "function" ? (roster.getReceipt() || {}) : {};
    } catch (_) { return {}; }
  }

  async function renderedCardDomState(historyPatients, prePullFacts) {
    const safe = { complete: false, patientCount: 0, exactPatientCount: 0, exactCardCount: 0, visibleCardCount: 0, expectedCardCount: array(historyPatients).length * CARD_KEYS.length };
    if (!document || typeof document.getElementById !== "function" || typeof document.querySelector !== "function" ||
        typeof window.getActivePtId !== "function" || typeof window.setActivePtId !== "function" ||
        typeof window.renderProfile !== "function" || typeof window.getPatients !== "function") return safe;
    const patientsById = Object.create(null);
    array(window.getPatients()).forEach(patient => {
      const id = String(patient && patient.id || "").trim();
      if (id) patientsById[id] = patient;
    });
    const originalId = String(window.getActivePtId() || "");
    const selectors = {
      problems: "#profProblems",
      meds: "#profMeds",
      allergies: "#profAllergies",
      summary: "#profSummary",
      vitals: "#mlsEpVitalsBox .body",
      history: "#mlsEpHistoryBox .body"
    };
    try {
      for (const receipt of array(historyPatients)) {
        const patientId = String(receipt && receipt.patientId || "").trim();
        const patient = patientId ? patientsById[patientId] : null;
        if (!patient) continue;
        window.setActivePtId(patientId);
        window.renderProfile();
        await new Promise(resolve => setTimeout(resolve, 0));
        const profile = document.getElementById("profileCard");
        const name = document.getElementById("profName");
        const activeExact = String(window.getActivePtId() || "") === patientId && !!profile && !!name &&
          String(name.textContent || "").replace(/\s+/g, " ").trim() === String(patient.name || "").replace(/\s+/g, " ").trim();
        if (!activeExact) continue;
        safe.exactPatientCount++;
        const coverage = patient.athenaProfileCoverage || {};
        const snapshot = patient.athenaChartSnapshot || {};
        const priorSnapshot = prePullFacts && prePullFacts[patientId] && prePullFacts[patientId].snapshot || {};
        let patientCardsExact = true;
        CARD_KEYS.forEach(key => {
          const node = document.querySelector(selectors[key]);
          const card = coverage.cards && coverage.cards[key] || {};
          const text = String(node && node.textContent || "").replace(/\s+/g, " ").trim();
          const underProfile = !!(node && profile && typeof profile.contains === "function" && profile.contains(node));
          let explicitlyVisible = !!node && node.hidden !== true;
          try { if (String(node.getAttribute && node.getAttribute("aria-hidden") || "").toLowerCase() === "true") explicitlyVisible = false; } catch (_) {}
          try {
            const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(node) : null;
            if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) explicitlyVisible = false;
          } catch (_) {}
          const snapshotValue = key === "meds" ? (snapshot.meds || snapshot.medications) : snapshot[key];
          const priorValue = key === "meds" ? (priorSnapshot.meds || priorSnapshot.medications) : priorSnapshot[key];
          const domIncludes = (key === "problems" || key === "meds" || key === "allergies")
            ? renderedIncludesSnapshot(text, snapshotValue, key)
            : snapshotFactsFor(snapshotValue, key).length > 0 && snapshotFactsFor(snapshotValue, key).every(fact => boundedPhrasePresent(text, fact));
          const domExcludes = (key === "problems" || key === "meds" || key === "allergies")
            ? renderedExcludesSnapshot(text, priorValue, key)
            : snapshotFactsFor(priorValue, key).every(fact => !boundedPhrasePresent(text, fact));
          const foundExact = card.status === "found" && card.populated === true && text &&
            domIncludes;
          const emptyExact = card.status === "not_documented" && card.populated === false && text &&
            domExcludes;
          if (explicitlyVisible) safe.visibleCardCount++;
          if (underProfile && explicitlyVisible && (foundExact || emptyExact)) safe.exactCardCount++;
          else patientCardsExact = false;
        });
        if (patientCardsExact) safe.patientCount++;
      }
    } catch (_) {
      safe.complete = false;
    } finally {
      try {
        window.setActivePtId(originalId);
        window.renderProfile();
      } catch (_) {}
    }
    safe.complete = safe.patientCount === array(historyPatients).length &&
      safe.exactPatientCount === array(historyPatients).length && safe.exactCardCount === safe.expectedCardCount &&
      safe.visibleCardCount === safe.expectedCardCount;
    return safe;
  }

  function requestedProvider(options) {
    const raw = options && options.provider;
    const object = raw && typeof raw === "object" ? raw : null;
    const name = String(object ? (object.name || object.displayName || object.provider || "") : (raw || "")).trim();
    const id = String(object && object.id != null ? object.id : "").trim();
    const stableKey = String(object && (object.stableKey || object.stable_key) || "").trim();
    if (!id && !stableKey && (!name || /^all(?:\s+(?:providers?|doctors?))?$/i.test(name))) return { mode: "all", id: "", stableKey: "" };
    return {
      mode: "selected",
      id,
      stableKey
    };
  }

  function snapshotLocalBeforePull() {
    const out = Object.create(null);
    try {
      const patients = typeof window.getPatients === "function" ? array(window.getPatients()) : [];
      const model = window.__mlsVisitModel;
      patients.forEach(patient => {
        const id = String(patient && patient.id || "").trim();
        if (!id) return;
        let visits = [];
        try { visits = model && typeof model.getVisits === "function" ? array(model.getVisits(patient)) : array(patient.visits); }
        catch (_) {}
        let snapshot = {};
        try { snapshot = JSON.parse(JSON.stringify(patient && patient.athenaChartSnapshot || {})); } catch (_) {}
        out[id] = {
          remoteCount: visits.filter(visit => visit && /athena|legacy|grab|pullrec/i.test(String(visit.source || "")) &&
            visit.identityVerified === true && String(visit.identityBinding || "") === id).length,
          snapshot
        };
      });
    } catch (_) {}
    return out;
  }

  function localPatientState(historyPatients, pullStartedAt, batchRequestId, prePullFacts, frozenTargets) {
    let allPatients = [];
    try {
      allPatients = typeof window.getPatients === "function" ? array(window.getPatients()) : [];
    } catch (_) {}

    const byId = Object.create(null);
    allPatients.forEach(patient => {
      const id = String(patient && patient.id || "").trim();
      if (id) byId[id] = patient;
    });

    const model = window.__mlsVisitModel;
    const opApi = window.__mlsOpNoteHistory;
    const seenStable = Object.create(null);
    const tuples = [];
    const privateFacts = Object.create(null);
    const sortedReceipts = historyPatients.slice().sort((a, b) =>
      String(a && a.patientId || "").localeCompare(String(b && b.patientId || ""))
    );
    let localPatientMatches = 0;
    let verifiedVisits = 0;
    let fullDetailVerifiedVisits = 0;
    let missingBindingVerifiedVisits = 0;
    let crossBoundVerifiedVisits = 0;
    let missingStableKeyFullDetailVisits = 0;
    let insubstantialFullDetailVisits = 0;
    let duplicateStableKeys = 0;
    let crossPatientStableKeyCollisions = 0;
    let tupleExactCount = 0;
    let currentOperationProfileCount = 0;
    let opNoteContextCount = 0;
    let currentChartCoverageCount = 0;
    let reconcileCompleteCount = 0;
    let reconcileEvidenceBoundCount = 0;
    let authoritativeZeroCount = 0;
    let dobPersistedCount = 0;
    const patientRequestIds = Object.create(null);
    const patientRequestOrdinals = Object.create(null);
    let duplicatePatientRequestIds = 0;

    sortedReceipts.forEach((patientReceipt, index) => {
      const receiptId = String(patientReceipt && patientReceipt.patientId || "").trim();
      const patient = receiptId ? byId[receiptId] : null;
      const expected = evidenceCount(patientReceipt, "expectedVisits");
      const parsed = evidenceCount(patientReceipt, "parsedVisits");
      const persisted = evidenceCount(patientReceipt, "persistedVisits");
      let localVerified = 0;
      let localFullDetail = 0;
      let usableVisits = [];
      let remoteUsableVisits = 0;
      let remoteUsableExact = true;
      const stableAliases = [];
      const stableBodyFingerprints = [];
      const localDob = validDob(patient && patient.dob || "");
      const frozenDob = validDob(frozenTargets && frozenTargets[receiptId] && frozenTargets[receiptId].dob || "");
      const dobPersistedExact = !!(patient && patientReceipt && patientReceipt.dobVerified === true && localDob && frozenDob === localDob);
      if (dobPersistedExact) dobPersistedCount++;

      if (patient) {
        localPatientMatches++;
        let visits = [];
        try {
          visits = model && typeof model.getVisits === "function" ? array(model.getVisits(patient)) : array(patient.visits);
        } catch (_) {}
        visits.forEach(visit => {
          const remote = /athena|legacy|grab|pullrec/i.test(String(visit && visit.source || ""));
          if (!remote || !visit || visit.identityVerified !== true) return;
          verifiedVisits++;
          localVerified++;
          const binding = String(visit.identityBinding || "").trim();
          if (!binding) missingBindingVerifiedVisits++;
          if (!binding || binding !== receiptId) crossBoundVerifiedVisits++;
          const rawBody = String(visit.raw || "").trim();
          const fullDetail = visit.indexOnly !== true && visit.fullDetail === true && visit.bodyComplete === true;
          if (!fullDetail) return;
          if (rawBody.length < MIN_VISIT_BODY_CHARS) { insubstantialFullDetailVisits++; return; }
          fullDetailVerifiedVisits++;
          localFullDetail++;
          const encounterId = String(visit.encounterId || visit.encounterID || "").trim().toLowerCase();
          const sourceVisitKey = String(visit.sourceVisitKey || visit.rowKey || "").trim().toLowerCase();
          const stableKey = encounterId ? "encounter|" + encounterId :
            (sourceVisitKey ? "source|" + sourceVisitKey : "");
          if (!stableKey) {
            missingStableKeyFullDetailVisits++;
            return;
          }
          stableAliases.push(stableKey);
          stableBodyFingerprints.push(stableKey + "|" + privateBodyProof(rawBody));
          if (seenStable[stableKey]) {
            duplicateStableKeys++;
            if (seenStable[stableKey] !== binding) crossPatientStableKeyCollisions++;
          } else seenStable[stableKey] = binding;
        });

        try {
          const internal = opApi && opApi._internal;
          usableVisits = internal && typeof internal.getVisitsFor === "function"
            ? array(internal.getVisitsFor(patient)) : [];
          usableVisits.forEach(visit => {
            if (!/athena|legacy|grab|pullrec/i.test(String(visit && visit.source || ""))) return;
            remoteUsableVisits++;
            const matches = internal && typeof internal.visitMatchesPatient === "function"
              ? internal.visitMatchesPatient(patient, visit) === true : false;
            if (!matches || visit.identityVerified !== true || String(visit.identityBinding || "") !== receiptId) {
              remoteUsableExact = false;
            }
          });
        } catch (_) {
          usableVisits = [];
          remoteUsableExact = false;
        }
      }

      const expectedSaveRequestId = String(patientReceipt && patientReceipt.requestId || "") + "-parse";
      const patientRequestId = String(patientReceipt && patientReceipt.requestId || "");
      const patientRequestMatch = batchRequestId
        ? patientRequestId.match(new RegExp("^" + String(batchRequestId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-p([1-9][0-9]*)$"))
        : null;
      const patientRequestBound = !!patientRequestMatch;
      if (patientRequestMatch) patientRequestOrdinals[patientRequestMatch[1]] = true;
      if (patientRequestId) {
        if (patientRequestIds[patientRequestId]) duplicatePatientRequestIds++;
        patientRequestIds[patientRequestId] = true;
      }
      const chartCoverage = patientReceipt && patientReceipt.chartCoverage || {};
      const chartExpected = evidenceCount(chartCoverage, "expectedClinicalFrames");
      const chartCaptured = capturedAt(chartCoverage.capturedAt);
      const currentChartCoverage = !!(patientRequestId && chartCoverage.kind === "athena-chart-coverage" &&
        chartCoverage.complete === true && chartCoverage.readerVersion === CHART_READER_VERSION &&
        chartCoverage.identityObserved === true && String(chartCoverage.requestId || "") === patientRequestId + "-chart" &&
        chartExpected !== null && chartExpected >= 1 &&
        evidenceCount(chartCoverage, "readClinicalFrames") === chartExpected &&
        evidenceCount(chartCoverage, "boundClinicalFrames") === chartExpected &&
        evidenceCount(chartCoverage, "unboundClinicalFrames") === 0 &&
        evidenceCount(chartCoverage, "oversizeClinicalFrames") === 0 &&
        evidenceCount(chartCoverage, "unreadFrames") === 0 &&
        evidenceCount(chartCoverage, "omittedForCap") === 0 && chartCoverage.truncated === false &&
        evidenceCount(chartCoverage, "textChars") !== null && evidenceCount(chartCoverage, "textChars") > 0 &&
        chartCaptured >= pullStartedAt && chartCaptured <= Date.now() + 5000);
      if (currentChartCoverage) currentChartCoverageCount++;
      const reconcileComplete = !!(patientReceipt && patientReceipt.reconcileReceipt &&
        patientReceipt.reconcileReceipt.complete === true);
      const reconcileRemoved = evidenceCount(patientReceipt && patientReceipt.reconcileReceipt || {}, "removed");
      const prePullRemoteCount = receiptId
        ? (hasOwn(prePullFacts || {}, receiptId) ? evidenceCount({ count: prePullFacts[receiptId] && prePullFacts[receiptId].remoteCount }, "count") : 0)
        : null;
      const reconcileEvidenceBound = reconcileRemoved !== null && prePullRemoteCount !== null &&
        reconcileRemoved <= prePullRemoteCount;
      if (reconcileEvidenceBound) reconcileEvidenceBoundCount++;
      if (reconcileComplete) reconcileCompleteCount++;
      const authoritativeZero = expected !== 0 || patientReceipt.authoritativeEmpty === true;
      if (authoritativeZero) authoritativeZeroCount++;
      const receiptCoverage = patientReceipt && patientReceipt.profileCoverage || {};
      const localCoverage = patient && patient.athenaProfileCoverage || {};
      const localSnapshot = patient && patient.athenaChartSnapshot || {};
      const priorSnapshot = receiptId && prePullFacts && prePullFacts[receiptId] && prePullFacts[receiptId].snapshot || {};
      const receiptCaptured = capturedAt(receiptCoverage.capturedAt);
      const localCaptured = capturedAt(localCoverage.capturedAt);
      const snapshotCaptured = capturedAt(localSnapshot.capturedAt || localSnapshot.pulledAt);
      const receiptCardsCurrent = patientReceipt && patientReceipt.profileCoverageFresh === true &&
        receiptCoverage.complete === true && receiptCoverage.exactIdentityVerified === true &&
        String(receiptCoverage.patientId || "") === receiptId &&
        String(receiptCoverage.saveRequestId || "") === expectedSaveRequestId &&
        receiptCaptured >= pullStartedAt && receiptCaptured <= Date.now() + 5000;
      const localCardsCurrent = localCoverage.complete === true && localCoverage.exactIdentityVerified === true &&
        String(localCoverage.patientId || "") === receiptId &&
        String(localCoverage.saveRequestId || "") === expectedSaveRequestId &&
        localCaptured >= pullStartedAt && localCaptured <= Date.now() + 5000 &&
        snapshotCaptured >= pullStartedAt && snapshotCaptured <= Date.now() + 5000;
      let localCardsExact = true;
      let snapshotCardsExact = true;
      let renderedCardsExact = true;
      let staleAthenaFactsCleared = true;
      let localCardMask = 0;
      CARD_KEYS.forEach((key, cardIndex) => {
        const receiptCard = receiptCoverage.cards && receiptCoverage.cards[key] || {};
        const localCard = localCoverage.cards && localCoverage.cards[key] || {};
        const receiptClassified = (receiptCard.status === "found" && receiptCard.populated === true) ||
          (receiptCard.status === "not_documented" && receiptCard.populated === false);
        const localClassified = (localCard.status === "found" && localCard.populated === true) ||
          (localCard.status === "not_documented" && localCard.populated === false);
        if (!receiptClassified || !localClassified || receiptCard.status !== localCard.status ||
            receiptCard.populated !== localCard.populated) localCardsExact = false;
        const snapshotValue = key === "meds" ? (localSnapshot.meds || localSnapshot.medications) : localSnapshot[key];
        const snapshotPopulated = hasSubstantiveData(snapshotValue);
        if ((localCard.status === "found" && snapshotPopulated !== true) ||
            (localCard.status === "not_documented" && snapshotPopulated !== false)) snapshotCardsExact = false;
        const renderedValue = key === "meds" ? [patient && patient.meds, patient && patient.medications] : patient && patient[key];
        if (localCard.status === "found" && !renderedIncludesSnapshot(renderedValue, snapshotValue, key)) renderedCardsExact = false;
        const priorSnapshotValue = key === "meds" ? (priorSnapshot.meds || priorSnapshot.medications) : priorSnapshot[key];
        if (localCard.status === "not_documented" && !renderedExcludesSnapshot(renderedValue, priorSnapshotValue, key)) staleAthenaFactsCleared = false;
        if (localCard.status === "found" && localCard.populated === true) localCardMask |= (1 << cardIndex);
      });
      const currentOperationProfile = receiptCardsCurrent && localCardsCurrent && localCardsExact && snapshotCardsExact && renderedCardsExact && staleAthenaFactsCleared;
      if (currentOperationProfile) currentOperationProfileCount++;

      const tupleExact = patient && expected !== null && parsed !== null && persisted !== null &&
        expected === parsed && parsed === persisted && persisted === localFullDetail &&
        localVerified === localFullDetail;
      if (tupleExact) tupleExactCount++;

      let opNoteContext = false;
      let opNoteVisitCount = 0;
      try {
        const internal = opApi && opApi._internal;
        const built = patient && internal && typeof internal.buildHistoryContext === "function"
          ? internal.buildHistoryContext(patient.name, {
              patientId: receiptId,
              dob: String(patient.dob || ""),
              procedure: "Read-only acceptance context check"
            })
          : null;
        const text = String(built && built.text || "");
        opNoteVisitCount = evidenceCount(built || {}, "visitCount");
        const contextBuilt = !!(built && built.ok === true && String(built.patientId || "") === receiptId &&
          localDob && validDob(built.patientDob) === localDob &&
          opNoteVisitCount !== null && opNoteVisitCount === usableVisits.length &&
          expected !== null && remoteUsableVisits === expected && opNoteVisitCount >= expected &&
          remoteUsableExact && built.snapshotIncluded === true && text.length > 100 &&
          oneMarker(text, "=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===") &&
          oneMarker(text, "=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===") &&
          oneMarker(text, "PRIOR LONGITUDINAL HISTORY"));
        const procedure = "Read-only acceptance context check";
        const sys = "Write an operative / procedure note using the exact patient context.";
        const initialOpts = { mlsOpNotePatientId: receiptId };
        const initialUser = "PATIENT: " + String(patient && patient.name || "") + "\n- DOB: " +
          String(patient && patient.dob || "") + "\nPROCEDURE: " + procedure +
          "\n\nSELECTED TEMPLATE — COPY ITS STRUCTURE:\nProcedure note";
        const initialAt = Date.now();
        const initialOut = internal && typeof internal.injectIfOpNote === "function"
          ? internal.injectIfOpNote(sys, initialUser, initialOpts) : "";
        const binding = initialOpts.mlsVerifiedHistoryBinding;
        const initialReceipt = opApi && opApi.lastInjectionReceipt || {};
        const initialValid = opApi && typeof opApi.validateBinding === "function"
          ? opApi.validateBinding(initialOpts) : { ok: false };
        const initialBegin = initialOut.indexOf("=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===");
        const initialEnd = initialOut.indexOf("=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===");
        const initialTemplate = initialOut.indexOf("SELECTED TEMPLATE");
        const initialInjected = !!(binding && Object.isFrozen(binding) && initialValid.ok === true &&
          String(binding.patientId || "") === receiptId && String(binding.patientDob || "") === String(built && built.patientDob || "") &&
          validDob(binding.patientDob) === localDob &&
          String(binding.procedure || "") === procedure && !!String(binding.token || "") &&
          oneMarker(initialOut, "=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===") &&
          oneMarker(initialOut, "=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===") &&
          oneMarker(initialOut, text) &&
          initialBegin >= 0 && initialBegin < initialEnd && initialEnd < initialTemplate &&
          initialReceipt.included === true && initialReceipt.identityVerified === true && initialReceipt.phase === "initial" &&
          capturedAt(initialReceipt.at) >= initialAt && initialReceipt.visitCount === opNoteVisitCount &&
          initialReceipt.snapshotIncluded === true && number(initialReceipt.historyChars) > 0 &&
          String(initialReceipt.contextToken || "") === String(binding.token || ""));
        const repairOpts = {
          mlsOpNotePatientId: receiptId,
          mlsOpNotePhase: "repair",
          mlsTemplateFidelity: true,
          mlsVerifiedHistoryBinding: binding
        };
        const repairAt = Date.now();
        const repairOut = internal && typeof internal.injectIfOpNote === "function"
          ? internal.injectIfOpNote("Repair the draft while preserving the verified exact-patient context.",
              "SELECTED TEMPLATE:\nProcedure note", repairOpts) : "";
        const repairReceipt = opApi && opApi.lastInjectionReceipt || {};
        const repairValid = opApi && typeof opApi.validateBinding === "function"
          ? opApi.validateBinding(repairOpts) : { ok: false };
        const repairBegin = repairOut.indexOf("=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===");
        const repairEnd = repairOut.indexOf("=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===");
        const repairTemplate = repairOut.indexOf("SELECTED TEMPLATE:");
        const repairInjected = !!(repairValid.ok === true && repairOpts.mlsVerifiedHistoryBinding === binding &&
          Object.isFrozen(repairOpts.mlsVerifiedHistoryBinding) &&
          String(repairOpts.mlsVerifiedHistoryBinding && repairOpts.mlsVerifiedHistoryBinding.token || "") === String(binding && binding.token || "") &&
          oneMarker(repairOut, "=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===") &&
          oneMarker(repairOut, "=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===") &&
          oneMarker(repairOut, text) &&
          repairBegin >= 0 && repairBegin < repairEnd && repairEnd < repairTemplate &&
          repairReceipt.included === true && repairReceipt.identityVerified === true && repairReceipt.phase === "repair" &&
          capturedAt(repairReceipt.at) >= repairAt && repairReceipt.visitCount === opNoteVisitCount &&
          repairReceipt.snapshotIncluded === true && number(repairReceipt.historyChars) > 0 &&
          String(repairReceipt.contextToken || "") === String(binding && binding.token || ""));
        opNoteContext = contextBuilt && initialInjected && repairInjected;
      } catch (_) {}
      if (opNoteContext) opNoteContextCount++;

      const safeTuple = {
        index: index + 1,
        expected,
        parsed,
        persisted,
        localFullDetail,
        localVerified,
        tupleExact,
        patientRequestBound,
        currentChartCoverage,
        reconcileComplete,
        reconcileRemoved,
        reconcileEvidenceBound,
        authoritativeZero,
        dobPersistedExact,
        localCardsExact,
        snapshotCardsExact,
        renderedCardsExact,
        staleAthenaFactsCleared,
        currentOperationProfile,
        opNoteContext,
        opNoteVisitCount
      };
      tuples.push(safeTuple);
      if (receiptId) privateFacts[receiptId] = {
        expected, parsed, persisted, localFullDetail, localVerified,
        tupleExact, patientRequestBound, currentChartCoverage, reconcileComplete, reconcileRemoved, reconcileEvidenceBound,
        authoritativeZero, dobPersistedExact, localCardsExact, snapshotCardsExact, renderedCardsExact, staleAthenaFactsCleared, localCardMask,
        stableAliases: stableAliases.slice().sort(), stableBodyFingerprints: stableBodyFingerprints.slice().sort(),
        usableVisitCount: usableVisits.length, currentOperationProfile, opNoteContext,
        dobProof: localDob
      };
    });

    return {
      safe: {
        localPatientMatches,
        verifiedVisits,
        fullDetailVerifiedVisits,
        missingBindingVerifiedVisits,
        crossBoundVerifiedVisits,
        missingStableKeyFullDetailVisits,
        insubstantialFullDetailVisits,
        duplicateStableKeys,
        crossPatientStableKeyCollisions,
        tupleExactCount,
        currentOperationProfileCount,
        opNoteContextCount,
        currentChartCoverageCount,
        reconcileCompleteCount,
        reconcileEvidenceBoundCount,
        authoritativeZeroCount,
        dobPersistedCount,
        uniquePatientRequestIds: Object.keys(patientRequestIds).length,
        duplicatePatientRequestIds,
        patientRequestOrdinalSetExact: sortedReceipts.every((_, ordinal) => patientRequestOrdinals[String(ordinal + 1)] === true) &&
          Object.keys(patientRequestOrdinals).length === sortedReceipts.length,
        tuples
      },
      facts: {
        patientIds: Object.keys(privateFacts).sort(),
        patients: privateFacts
      }
    };
  }

  function repeatEvidence(previousFacts, currentFacts, previousSummary, expectedScheduleRows, expectedScopedRows, expectedPatientRows) {
    if (!previousFacts || !currentFacts || !previousSummary) {
      return { samePatientSet: false, sameMappingTuples: false, noPatientRegression: false, sameExpectedCount: false };
    }
    const samePatientSet = sameStrings(previousFacts.patientIds, currentFacts.patientIds);
    const sameMappingTuples = sameStrings(previousFacts.mappingTuples, currentFacts.mappingTuples);
    const sameExpectedCount = previousSummary.expectedScheduleRows === expectedScheduleRows &&
      previousSummary.expectedScopedRows === expectedScopedRows &&
      previousSummary.expectedPatientRows === expectedPatientRows;
    let noPatientRegression = samePatientSet;
    if (noPatientRegression) {
      previousFacts.patientIds.forEach(id => {
        const before = previousFacts.patients[id];
        const after = currentFacts.patients[id];
        const sameExpectedVisits = !!(before && after && after.expected === before.expected);
        const stableAliasesSafe = !!(before && after && (sameExpectedVisits
          ? sameStrings(before.stableAliases, after.stableAliases)
          : stringSubset(before.stableAliases, after.stableAliases)));
        const stableBodiesSafe = !!(before && after && (sameExpectedVisits
          ? sameStrings(before.stableBodyFingerprints, after.stableBodyFingerprints)
          : stringSubset(before.stableBodyFingerprints, after.stableBodyFingerprints)));
        const cardsNoRegression = !!(before && after && (after.localCardMask | before.localCardMask) === after.localCardMask);
        const usableNoRegression = !!(before && after && (sameExpectedVisits
          ? after.usableVisitCount === before.usableVisitCount
          : after.usableVisitCount >= before.usableVisitCount));
        const sameDobProof = !!(before && after && before.dobProof && after.dobProof === before.dobProof);
        if (!before || !after || after.tupleExact !== true || after.patientRequestBound !== true ||
            after.currentChartCoverage !== true ||
            after.reconcileComplete !== true || after.authoritativeZero !== true ||
            after.reconcileRemoved !== 0 || stableAliasesSafe !== true || stableBodiesSafe !== true || cardsNoRegression !== true ||
            usableNoRegression !== true || sameDobProof !== true || after.dobPersistedExact !== true || after.localCardsExact !== true || after.snapshotCardsExact !== true || after.renderedCardsExact !== true ||
            after.currentOperationProfile !== true || after.opNoteContext !== true || after.expected < before.expected ||
            after.parsed < before.parsed || after.persisted < before.persisted ||
            after.localFullDetail < before.localFullDetail) noPatientRegression = false;
      });
    }
    return { samePatientSet, sameMappingTuples, noPatientRegression, sameExpectedCount };
  }

  async function summarize(result, options, runNumber, scopeKey, previousRecord, pullStartedAt, prePullFacts) {
    const res = result && typeof result === "object" ? result : {};
    const schedule = res.scheduleReceipt || {};
    const provider = res.providerReceipt || {};
    const providerRoster = currentRosterReceipt(res);
    const attachedProviderRoster = res.providerRosterReceipt && typeof res.providerRosterReceipt === "object" ? res.providerRosterReceipt : {};
    const liveProviderRoster = liveRosterReceipt();
    const calendar = res.calendarReceipt || {};
    const history = res.historyReceipt || {};
    const identityBootstrap = res.identityBootstrapReceipt || {};
    const patients = array(history.patients);
    const retries = array(history.retry);
    const resolvedAppointments = array(res.resolvedAppointments);
    const historyTargets = array(res.historyTargets);
    const historyUnresolved = array(res.historyUnresolved);
    const scheduleRows = evidenceCount(schedule, "expectedCount");
    const providerMode = String(provider.mode || "").toLowerCase();
    const requestedProviderProof = requestedProvider(options || {});
    const requestedDate = String(options && options.date || "");
    const resultDate = String(res.target || "");
    const providerMatching = evidenceCount(provider, "matchingRows");
    const scopedRows = providerMode === "selected" ? providerMatching :
      (providerMode === "all" ? scheduleRows : null);
    const resolvedPatientIds = Object.create(null);
    const sourceIdentities = Object.create(null);
    const backendAppointmentIds = Object.create(null);
    const mappingTuples = [];
    let resolvedPatientIdsComplete = true;
    let mappingFieldsComplete = true;
    let mappingDatesExact = true;
    let uniqueSourceIdentities = true;
    let uniqueBackendAppointmentIds = true;
    resolvedAppointments.forEach(mapping => {
      const id = String(mapping && mapping.patientId || "").trim();
      const sourceIdentity = String(mapping && mapping.sourceIdentity || "").trim();
      const backendAppointmentId = String(mapping && mapping.backendAppointmentId || "").trim();
      const date = String(mapping && mapping.date || "");
      if (!id) resolvedPatientIdsComplete = false;
      else resolvedPatientIds[id] = true;
      if (!sourceIdentity || !backendAppointmentId || !id || !date) mappingFieldsComplete = false;
      if (date !== resultDate) mappingDatesExact = false;
      if (sourceIdentity) {
        if (sourceIdentities[sourceIdentity]) uniqueSourceIdentities = false;
        sourceIdentities[sourceIdentity] = true;
      }
      if (backendAppointmentId) {
        if (backendAppointmentIds[backendAppointmentId]) uniqueBackendAppointmentIds = false;
        backendAppointmentIds[backendAppointmentId] = true;
      }
      mappingTuples.push(JSON.stringify([sourceIdentity, backendAppointmentId, id, date]));
    });
    mappingTuples.sort();
    const patientRows = Object.keys(resolvedPatientIds).length;
    const frozenTargets = Object.create(null);
    let frozenTargetsComplete = true;
    let frozenTargetDatesExact = true;
    historyTargets.forEach(target => {
      const idAliases = ["_mlsTargetPatientId", "patientId", "patient_external_id"]
        .filter(key => hasOwn(target, key)).map(key => String(target[key] == null ? "" : target[key]).trim());
      const dobAliases = ["_mlsTargetDob", "dob"]
        .filter(key => hasOwn(target, key)).map(key => validDob(target[key]));
      const dateAliases = ["scheduleDate", "date"]
        .filter(key => hasOwn(target, key)).map(key => String(target[key] == null ? "" : target[key]).trim());
      const id = idAliases[0] || "";
      const dob = dobAliases[0] || "";
      const date = dateAliases[0] || "";
      const idAliasesExact = idAliases.length > 0 && idAliases.every(value => value && value === id);
      const dobAliasesExact = dobAliases.length > 0 && dobAliases.every(value => value && value === dob);
      const dateAliasesExact = dateAliases.length > 0 && dateAliases.every(value => value && value === date);
      if (!dateAliasesExact || date !== resultDate) frozenTargetDatesExact = false;
      if (!idAliasesExact || !dobAliasesExact || !dateAliasesExact || frozenTargets[id]) frozenTargetsComplete = false;
      else frozenTargets[id] = { dob, date };
    });
    const importerVersion = String(api.version || "");
    const extensionVersion = String(window.__mlsExtReportedVersion || "");
    const assetVersion = String(window.__MLS_AV || "");
    const observedBuild = window.__mlsPhiFreeAcceptanceObservedBuild && typeof window.__mlsPhiFreeAcceptanceObservedBuild === "object"
      ? window.__mlsPhiFreeAcceptanceObservedBuild : {};

    let canonical = {};
    try {
      canonical = typeof api.authoritativeStatusForDay === "function"
        ? (api.authoritativeStatusForDay(resultDate, options && options.provider) || {}) : {};
    } catch (_) {}

    const uniquePatients = Object.create(null);
    const versions = Object.create(null);
    const cards = {};
    CARD_KEYS.forEach(key => { cards[key] = { found: 0, verifiedEmpty: 0, invalid: 0, total: patients.length }; });
    let exactIdentityCount = 0;
    let identityProofCount = 0;
    let dobProofCount = 0;
    let mrnProofCount = 0;
    let dobVerifiedPatientCount = 0;
    let completePatientCount = 0;
    let organizedPatientCount = 0;
    let organizationCompletePatientCount = 0;
    let visitsCompletePatientCount = 0;
    let visitsCoverageCompletePatientCount = 0;
    let profileCompletePatientCount = 0;
    let profileExactPatientCount = 0;
    let r4ReaderCount = 0;
    let expectedVisitCount = 0;
    let parsedVisitCount = 0;
    let persistedVisitCount = 0;
    let authoritativeEmptyPatientCount = 0;
    let visitCountEvidenceComplete = true;
    const chartReasonCounts = Object.create(null);
    const visitsReasonCounts = Object.create(null);
    const finalReasonCounts = Object.create(null);

    patients.forEach(patient => {
      const patientId = String(patient && patient.patientId || "").trim();
      if (patientId) uniquePatients[patientId] = true;
      if (patient && patient.identityVerified === true) exactIdentityCount++;
      if (patient && (patient.identityProof === "dob" || patient.identityProof === "mrn")) identityProofCount++;
      if (patient && patient.identityProof === "dob") dobProofCount++;
      if (patient && patient.identityProof === "mrn") mrnProofCount++;
      if (patient && patient.dobVerified === true) dobVerifiedPatientCount++;
      if (patient && patient.complete === true) completePatientCount++;
      if (patient && patient.organized === true) organizedPatientCount++;
      if (patient && patient.organizationComplete === true) organizationCompletePatientCount++;
      if (patient && patient.visitsComplete === true) visitsCompletePatientCount++;
      if (patient && patient.visitsCoverageComplete === true) visitsCoverageCompletePatientCount++;
      if (patient && patient.authoritativeEmpty === true) authoritativeEmptyPatientCount++;
      chartReasonCounts[reasonCategory(patient && patient.chartReason)] =
        number(chartReasonCounts[reasonCategory(patient && patient.chartReason)]) + 1;
      visitsReasonCounts[reasonCategory(patient && patient.visitsReason)] =
        number(visitsReasonCounts[reasonCategory(patient && patient.visitsReason)]) + 1;
      finalReasonCounts[reasonCategory(patient && patient.reason)] =
        number(finalReasonCounts[reasonCategory(patient && patient.reason)]) + 1;

      const expected = evidenceCount(patient, "expectedVisits");
      const parsed = evidenceCount(patient, "parsedVisits");
      const persisted = evidenceCount(patient, "persistedVisits");
      if (expected === null || parsed === null || persisted === null) visitCountEvidenceComplete = false;
      else {
        expectedVisitCount += expected;
        parsedVisitCount += parsed;
        persistedVisitCount += persisted;
      }

      const readerVersion = String(patient && patient.visitsReaderVersion || "");
      if (readerVersion) versions[readerVersion] = true;
      if (readerVersion === R4_READER_VERSION) r4ReaderCount++;
      const coverage = patient && patient.profileCoverage || {};
      if (coverage.complete === true) profileCompletePatientCount++;
      if (coverage.complete === true && coverage.exactIdentityVerified === true &&
          String(coverage.patientId || "") === patientId) profileExactPatientCount++;
      CARD_KEYS.forEach(key => {
        const card = coverage.cards && coverage.cards[key] || {};
        const status = String(card.status || "");
        const found = status === "found" && card.populated === true;
        const verifiedEmpty = status === "not_documented" && card.populated === false;
        if (found) cards[key].found++;
        else if (verifiedEmpty) cards[key].verifiedEmpty++;
        else cards[key].invalid++;
      });
    });

    const local = localPatientState(patients, pullStartedAt, String(history.requestId || ""), prePullFacts || {}, frozenTargets);
    const persisted = local.safe;
    const domCards = await renderedCardDomState(patients, prePullFacts || {});
    const expectedReady = scheduleRows !== null && scopedRows !== null;
    const allSixCardsClassified = expectedReady && CARD_KEYS.every(key =>
      cards[key].total === patientRows && cards[key].invalid === 0 &&
      cards[key].found + cards[key].verifiedEmpty === patientRows
    );
    const receiptPatientIds = Object.keys(uniquePatients).sort();
    const resolvedPatientSet = Object.keys(resolvedPatientIds).sort();
    const frozenTargetSet = Object.keys(frozenTargets).sort();
    const localPatientSet = array(local.facts && local.facts.patientIds).slice().sort();
    const mappingTupleGate = expectedReady && resolvedAppointments.length === scopedRows && mappingTuples.length === scopedRows &&
      mappingFieldsComplete && mappingDatesExact && uniqueSourceIdentities && uniqueBackendAppointmentIds &&
      Object.keys(sourceIdentities).length === scopedRows && Object.keys(backendAppointmentIds).length === scopedRows;
    const cohortGate = expectedReady && mappingTupleGate && resolvedPatientIdsComplete &&
      patientRows <= scopedRows && historyUnresolved.length === 0 && frozenTargetsComplete &&
      frozenTargetDatesExact &&
      historyTargets.length === patientRows && patients.length === patientRows &&
      sameStrings(resolvedPatientSet, frozenTargetSet) && sameStrings(resolvedPatientSet, receiptPatientIds) &&
      sameStrings(resolvedPatientSet, localPatientSet);

    const declaredCount = evidenceCount(schedule, "declaredCount");
    const declaredCountStrategy = String(schedule.countStrategy || "");
    const declaredCountReason = String(schedule.declaredCountReason || "");
    const declaredCountAuthoritative = schedule.declaredCountAuthoritative;
    const countProvenancePairs = {
      "single-provider-declared-total": { authoritative: true, reasons: ["single-provider-surface-total"] },
      "legacy-grid-candidate-rows": { authoritative: false, reasons: ["legacy-header-may-include-capacity"] },
      "verified-viewport-candidates": { authoritative: false, reasons: ["multi-provider-column-count-not-total", "no-authoritative-declared-total"] },
      "verified-rendered-candidates": { authoritative: false, reasons: ["multi-provider-column-count-not-total", "no-authoritative-declared-total"] }
    };
    const countProvenanceSpec = countProvenancePairs[declaredCountStrategy] || null;
    const countProvenanceKnown = hasOwn(countProvenancePairs, declaredCountStrategy) &&
      countProvenanceSpec.reasons.indexOf(declaredCountReason) >= 0 &&
      typeof declaredCountAuthoritative === "boolean" && declaredCountAuthoritative === countProvenanceSpec.authoritative &&
      hasOwn(schedule, "declaredCount") && declaredCount !== null;
    const countProvenanceArithmetic = countProvenanceKnown && (declaredCountAuthoritative === true
      ? declaredCount !== null && declaredCount === scheduleRows
      : evidenceCount(schedule, "candidateCount") === scheduleRows) &&
      (scheduleRows !== 0 || (schedule.authoritativeEmpty === true && declaredCount === 0 &&
        evidenceCount(schedule, "candidateCount") === 0 && evidenceCount(schedule, "parsedCount") === 0 &&
        evidenceCount(schedule, "mergedRows") === 0));
    const scheduleGate = scheduleRows !== null && res.scheduleVerified === true && schedule.complete === true &&
      evidenceCount(schedule, "candidateCount") === scheduleRows &&
      evidenceCount(schedule, "parsedCount") === scheduleRows &&
      evidenceCount(schedule, "mergedRows") === scheduleRows &&
      evidenceCount(schedule, "unnamedCount") === 0 && schedule.viewportCoverageComplete === true &&
      (scheduleRows > 0 || schedule.authoritativeEmpty === true) && countProvenanceArithmetic;

    const sourceRows = evidenceCount(provider, "sourceRows");
    const taggedRows = evidenceCount(provider, "providerTaggedRows");
    const mismatchedRows = evidenceCount(provider, "mismatchedRows");
    const providerModeExact = providerMode === "all" || providerMode === "selected";
    const providerArithmetic = providerMode === "selected"
      ? providerMatching !== null && mismatchedRows !== null &&
        providerMatching + mismatchedRows === scheduleRows
      : providerMode === "all" && providerMatching === 0 && mismatchedRows === 0 && scopedRows === scheduleRows;
    const selectedProviderIdentity = providerMode !== "selected" ||
      (provider.rosterVerified === true && !!String(provider.requestedId || provider.requestedStableKey || ""));
    const requestedProviderBound = requestedProviderProof.mode === providerMode &&
      (providerMode === "all" || (!!(requestedProviderProof.id || requestedProviderProof.stableKey) &&
        (!requestedProviderProof.id || String(provider.requestedId || "") === requestedProviderProof.id) &&
        (!requestedProviderProof.stableKey || String(provider.requestedStableKey || "") === requestedProviderProof.stableKey)));
    const providerGate = expectedReady && providerModeExact && selectedProviderIdentity && requestedProviderBound &&
      provider.complete === true && provider.scheduleComplete === true &&
      sourceRows === scheduleRows && taggedRows === scheduleRows &&
      evidenceCount(provider, "unattributedRows") === 0 && providerArithmetic;

    const rosterObserved = evidenceCount(attachedProviderRoster, "observedCount");
    const rosterDeclared = evidenceCount(attachedProviderRoster, "expectedCount");
    const rosterListed = evidenceCount(attachedProviderRoster, "listedCount");
    const attachedRosterKeys = array(attachedProviderRoster.identityKeys).map(value => String(value || "").trim());
    const liveRosterKeys = array(liveProviderRoster.identityKeys).map(value => String(value || "").trim());
    const rosterDeclaredConsistent = rosterDeclared !== null && rosterDeclared === rosterObserved && rosterListed === rosterObserved;
    const attachedRosterAvailable = Object.keys(attachedProviderRoster).length > 0;
    const liveRosterAvailable = Object.keys(liveProviderRoster).length > 0;
    const attachedRosterAt = capturedAt(attachedProviderRoster.updatedAt);
    const liveRosterAt = capturedAt(liveProviderRoster.updatedAt);
    const attachedRosterFresh = attachedRosterAt >= pullStartedAt && attachedRosterAt <= Date.now() + 5000;
    const liveRosterFresh = liveRosterAt >= pullStartedAt && liveRosterAt <= Date.now() + 5000;
    const attachedRosterKeysExact = nonblankUniqueStrings(attachedRosterKeys) && attachedRosterKeys.length === rosterObserved;
    const liveRosterKeysExact = nonblankUniqueStrings(liveRosterKeys) && liveRosterKeys.length === evidenceCount(liveProviderRoster, "observedCount");
    const scheduleRequestId = String(schedule.requestId || "").trim();
    const rosterOperationBound = receipt => {
      if (!receipt || String(receipt.targetDate || "") !== resultDate || !scheduleRequestId ||
          String(receipt.requestId || "").trim() !== scheduleRequestId || String(receipt.providerMode || "").toLowerCase() !== providerMode) return false;
      const receiptId = String(receipt.requestedProviderId || "").trim();
      const receiptStableKey = String(receipt.requestedProviderStableKey || "").trim();
      if (providerMode === "all") return !receiptId && !receiptStableKey;
      return requestedProviderProof.mode === "selected" &&
        (!requestedProviderProof.id || receiptId === requestedProviderProof.id) &&
        (!requestedProviderProof.stableKey || receiptStableKey === requestedProviderProof.stableKey) &&
        !!(receiptId || receiptStableKey);
    };
    const attachedRosterOperationBound = rosterOperationBound(attachedProviderRoster);
    const liveRosterOperationBound = rosterOperationBound(liveProviderRoster);
    const providerRosterAgreement = attachedRosterAvailable && liveRosterAvailable && attachedRosterFresh && liveRosterFresh &&
      attachedRosterOperationBound && liveRosterOperationBound && attachedRosterKeysExact && liveRosterKeysExact && sameStrings(attachedRosterKeys, liveRosterKeys) &&
      attachedProviderRoster.complete === liveProviderRoster.complete &&
      attachedProviderRoster.partial === liveProviderRoster.partial &&
      String(attachedProviderRoster.reason || "") === String(liveProviderRoster.reason || "") &&
      evidenceCount(attachedProviderRoster, "expectedCount") === evidenceCount(liveProviderRoster, "expectedCount") &&
      evidenceCount(attachedProviderRoster, "observedCount") === evidenceCount(liveProviderRoster, "observedCount") &&
      evidenceCount(attachedProviderRoster, "listedCount") === evidenceCount(liveProviderRoster, "listedCount") &&
      attachedProviderRoster.reachedEnd === liveProviderRoster.reachedEnd &&
      attachedProviderRoster.capReached === liveProviderRoster.capReached &&
      attachedProviderRoster.budgetExpired === liveProviderRoster.budgetExpired &&
      attachedProviderRoster.restored === liveProviderRoster.restored &&
      attachedProviderRoster.boundsStable === liveProviderRoster.boundsStable &&
      evidenceCount(attachedProviderRoster, "steps") === evidenceCount(liveProviderRoster, "steps") &&
      String(attachedProviderRoster.targetDate || "") === String(liveProviderRoster.targetDate || "") &&
      String(attachedProviderRoster.requestId || "") === String(liveProviderRoster.requestId || "") &&
      String(attachedProviderRoster.providerMode || "") === String(liveProviderRoster.providerMode || "") &&
      String(attachedProviderRoster.requestedProviderId || "") === String(liveProviderRoster.requestedProviderId || "") &&
      String(attachedProviderRoster.requestedProviderStableKey || "") === String(liveProviderRoster.requestedProviderStableKey || "") &&
      attachedRosterAt === liveRosterAt;
    const requestedRosterKeys = [requestedProviderProof.stableKey, requestedProviderProof.id,
      requestedProviderProof.id ? "athena-id:" + requestedProviderProof.id : "",
      requestedProviderProof.id ? "backend:" + requestedProviderProof.id : ""].filter(Boolean);
    const selectedRosterBound = providerMode !== "selected" || requestedRosterKeys.some(key => attachedRosterKeys.indexOf(key) >= 0);
    const providerRosterGate = providerRosterAgreement && selectedRosterBound && providerRoster.complete === true && providerRoster.partial === false &&
      rosterObserved !== null && rosterObserved > 0 && rosterDeclaredConsistent &&
      providerRoster.reachedEnd === true && providerRoster.capReached === false &&
      providerRoster.budgetExpired === false && providerRoster.restored === true &&
      providerRoster.boundsStable === true;

    const calendarGate = expectedReady && mappingTupleGate && calendar.complete === true &&
      evidenceCount(calendar, "attempted") === scopedRows &&
      evidenceCount(calendar, "accounted") === scopedRows &&
      evidenceCount(calendar, "mapped") === scopedRows &&
      evidenceCount(calendar, "uniqueSources") === scopedRows &&
      evidenceCount(calendar, "uniqueBackend") === scopedRows &&
      calendar.mappingComplete === true &&
      evidenceCount(calendar, "unresolvedMappings") === 0 &&
      evidenceCount(calendar, "failed") === 0 && evidenceCount(calendar, "wrongDay") === 0 &&
      evidenceCount(calendar, "invalidDate") === 0 && calendar.snapshotPublished === true;

    const canonicalGate = expectedReady && canonical.available === true && canonical.exact === true &&
      evidenceCount(canonical, "sourceCount") === scopedRows &&
      evidenceCount(canonical, "activeCount") === scopedRows &&
      evidenceCount(canonical, "missingCount") === 0 &&
      evidenceCount(canonical, "unclassifiedCount") === 0;

    const bootstrapAttempted = evidenceCount(identityBootstrap, "attempted");
    const bootstrapAlreadyProven = evidenceCount(identityBootstrap, "alreadyProven");
    const bootstrapRequested = evidenceCount(identityBootstrap, "requested");
    const bootstrapResolved = evidenceCount(identityBootstrap, "resolved");
    const bootstrapFailed = evidenceCount(identityBootstrap, "failed");
    const bootstrapAppointmentBound = evidenceCount(identityBootstrap, "appointmentBound");
    const bootstrapReasons = identityBootstrap.reasons && typeof identityBootstrap.reasons === "object" ? identityBootstrap.reasons : {};
    /* Aggregate per-proof evidence: every demographics-free row must carry one
       PHI-free bootstrap proof asserting the exact appointment-id binding, a
       true navigation delta, a fresh exact banner name+DOB, the requested
       date, and membership in THIS batch (the batch token encodes the
       hydration start time; every proof request id must carry that exact
       token, be unique, and the batch must have started inside this pull). */
    const bootstrapProofs = array(identityBootstrap.proofs);
    const bootstrapBatchToken = String(identityBootstrap.batchToken || "");
    const bootstrapBatchStartedAt = /^[a-z0-9]+$/.test(bootstrapBatchToken) ? parseInt(bootstrapBatchToken, 36) : 0;
    const bootstrapOperationBound = bootstrapBatchStartedAt > 0 &&
      bootstrapBatchStartedAt >= pullStartedAt && bootstrapBatchStartedAt <= Date.now() + 5000;
    const bootstrapProofIds = Object.create(null);
    const bootstrapProofsExact = hasOwn(identityBootstrap, "proofs") && Array.isArray(identityBootstrap.proofs) &&
      bootstrapResolved !== null && bootstrapProofs.length === bootstrapResolved &&
      bootstrapProofs.every(proof => {
        if (!proof || typeof proof !== "object") return false;
        const requestId = String(proof.requestId || "");
        const match = requestId.match(/^schedule-proof-([a-z0-9]+)-p(\d+)$/);
        if (!match || match[1] !== bootstrapBatchToken) return false;
        if (bootstrapProofIds[requestId]) return false;
        bootstrapProofIds[requestId] = true;
        return proof.appointmentIdBound === true && proof.navigationProven === true &&
          proof.exactNameMatched === true && proof.bannerIdentity === true &&
          proof.dobVerified === true && proof.requestBound === true &&
          String(proof.scheduleDate || "") === resultDate && resultDate === EXPECTED_TARGET_DATE;
      });
    const identityBootstrapGate = expectedReady && identityBootstrap.complete === true &&
      bootstrapAttempted === scopedRows && bootstrapAlreadyProven !== null && bootstrapRequested !== null &&
      bootstrapResolved !== null && bootstrapFailed === 0 && bootstrapAppointmentBound !== null &&
      bootstrapAlreadyProven + bootstrapResolved === bootstrapAttempted && bootstrapRequested === bootstrapResolved &&
      bootstrapAppointmentBound === bootstrapResolved && Object.keys(bootstrapReasons).length === 0 &&
      bootstrapProofsExact && bootstrapOperationBound;

    const historyRequestId = String(history.requestId || "");
    const historyStartedAt = capturedAt(history.startedAt);
    const historyRequestMatch = historyRequestId.match(/^history-batch-([a-z0-9]+)-([a-z0-9]+)$/i);
    const encodedHistoryStartedAt = historyRequestMatch ? parseInt(historyRequestMatch[1], 36) : 0;
    const historyOperationBound = !!(historyRequestMatch && encodedHistoryStartedAt > 0 &&
      Math.abs(encodedHistoryStartedAt - historyStartedAt) <= 10 &&
      historyStartedAt >= pullStartedAt && historyStartedAt <= Date.now() + 5000);
    const historyNonVacuous = patientRows === 0 || expectedVisitCount > 0;
    const historyGate = expectedReady && history.complete === true && history.exactIdentityVerified === true &&
      cohortGate && evidenceCount(history, "requested") === patientRows && evidenceCount(history, "processed") === patientRows &&
      patients.length === patientRows && Object.keys(uniquePatients).length === patientRows &&
      evidenceCount(history, "failures") === 0 && retries.length === 0 &&
      exactIdentityCount === patientRows && identityProofCount === patientRows &&
      dobVerifiedPatientCount === patientRows &&
      completePatientCount === patientRows && organizedPatientCount === patientRows &&
      organizationCompletePatientCount === patientRows && visitsCompletePatientCount === patientRows &&
      visitsCoverageCompletePatientCount === patientRows && profileCompletePatientCount === patientRows &&
      profileExactPatientCount === patientRows && r4ReaderCount === patientRows &&
      (patientRows === 0 ? Object.keys(versions).length === 0 : Object.keys(versions).length === 1) &&
      visitCountEvidenceComplete && historyNonVacuous && expectedVisitCount === parsedVisitCount &&
      parsedVisitCount === persistedVisitCount && persisted.localPatientMatches === patientRows &&
      persisted.tupleExactCount === patientRows && persisted.currentChartCoverageCount === patientRows &&
      persisted.reconcileCompleteCount === patientRows && persisted.reconcileEvidenceBoundCount === patientRows &&
      persisted.authoritativeZeroCount === patientRows &&
      persisted.dobPersistedCount === patientRows &&
      persisted.uniquePatientRequestIds === patientRows && persisted.duplicatePatientRequestIds === 0 &&
      persisted.patientRequestOrdinalSetExact === true &&
      persisted.tuples.every(tuple => tuple.patientRequestBound === true) &&
      number(chartReasonCounts.none) === patientRows && number(visitsReasonCounts.none) === patientRows &&
      number(finalReasonCounts.none) === patientRows && historyOperationBound && history.timedOut === false;

    const cardModelGate = allSixCardsClassified && persisted.currentOperationProfileCount === patientRows &&
      persisted.tuples.every(tuple => tuple.renderedCardsExact === true);
    const cardDomGate = domCards.complete === true && domCards.patientCount === patientRows &&
      domCards.exactPatientCount === patientRows && domCards.exactCardCount === patientRows * CARD_KEYS.length;
    const cardGate = cardModelGate && cardDomGate;
    const opNoteGate = persisted.opNoteContextCount === patientRows;
    const integrityGate = persisted.duplicateStableKeys === 0 &&
      persisted.crossPatientStableKeyCollisions === 0 && persisted.crossBoundVerifiedVisits === 0 &&
      persisted.missingBindingVerifiedVisits === 0 && persisted.missingStableKeyFullDetailVisits === 0 &&
      persisted.insubstantialFullDetailVisits === 0 &&
      persisted.verifiedVisits === expectedVisitCount &&
      persisted.fullDetailVerifiedVisits === expectedVisitCount;
    const dateGate = requestedDate === EXPECTED_TARGET_DATE && resultDate === EXPECTED_TARGET_DATE;
    const versionGate = importerVersion === EXPECTED_IMPORTER_VERSION &&
      extensionVersion === EXPECTED_EXTENSION_VERSION && assetVersion === EXPECTED_ASSET_VERSION;
    const observedBuildAt = capturedAt(observedBuild.capturedAt);
    const extensionBuildMessageGate = extensionBuildMessage.at >= pullStartedAt && extensionBuildMessage.at <= Date.now() + 5000 &&
      extensionBuildMessage.version === EXPECTED_EXTENSION_VERSION && extensionBuildMessage.digest === EXPECTED_BUILD.extensionSha256;
    const buildDigestGate = EXPECTED_BUILD.importerVersion === EXPECTED_IMPORTER_VERSION &&
      EXPECTED_BUILD.extensionVersion === EXPECTED_EXTENSION_VERSION && EXPECTED_BUILD.assetVersion === EXPECTED_ASSET_VERSION &&
      sha256(EXPECTED_BUILD.importerSha256) && sha256(EXPECTED_BUILD.extensionSha256) && sha256(EXPECTED_BUILD.assetSha256) &&
      String(observedBuild.importerVersion || "") === EXPECTED_BUILD.importerVersion &&
      String(observedBuild.extensionVersion || "") === EXPECTED_BUILD.extensionVersion &&
      String(observedBuild.assetVersion || "") === EXPECTED_BUILD.assetVersion &&
      String(observedBuild.importerSha256 || "").toLowerCase() === EXPECTED_BUILD.importerSha256 &&
      String(observedBuild.extensionSha256 || "").toLowerCase() === EXPECTED_BUILD.extensionSha256 &&
      String(observedBuild.assetSha256 || "").toLowerCase() === EXPECTED_BUILD.assetSha256 &&
      observedBuildAt >= pullStartedAt && observedBuildAt <= Date.now() + 5000 && extensionBuildMessageGate;
    const monthRequested = !!(options && (options.scope === "month" || options.mode === "month" || options.month)) ||
      !!(res && (res.scope === "month" || res.month));
    const monthManifestGate = monthRequested === false;
    const resultCreated = evidenceCount(res, "created");
    const resultRepaired = evidenceCount(res, "repaired");
    const resultSkipped = evidenceCount(res, "skipped");
    const resultGate = options && options.includeHistory !== false &&
      res.ok === true && res.complete === true && res.includeHistory === true &&
      evidenceCount(res, "failed") === 0 && expectedReady &&
      resultCreated !== null && resultRepaired !== null && resultSkipped !== null &&
      resultCreated === evidenceCount(calendar, "created") &&
      resultRepaired === evidenceCount(calendar, "repaired") &&
      resultSkipped === evidenceCount(calendar, "skipped") &&
      resultCreated + resultRepaired + resultSkipped === scopedRows;
    const contractPass = versionGate && buildDigestGate && dateGate && monthManifestGate && resultGate && scheduleGate && providerGate && providerRosterGate &&
      identityBootstrapGate &&
      cohortGate &&
      calendarGate && canonicalGate && historyGate && cardGate && opNoteGate && integrityGate;

    const sameScope = !!(previousRecord && previousRecord.scopeKey === scopeKey);
    const operationFacts = {
      patientIds: array(local.facts && local.facts.patientIds).slice(),
      patients: local.facts && local.facts.patients || Object.create(null),
      mappingTuples: mappingTuples.slice()
    };
    const repeat = repeatEvidence(
      sameScope ? previousRecord.facts : null,
      operationFacts,
      sameScope ? previousRecord.summary : null,
      scheduleRows,
      scopedRows,
      patientRows
    );
    const isRepeat = runNumber > 1 && sameScope;
    const repeatCreated = evidenceCount(res, "created");
    const repeatRepaired = evidenceCount(res, "repaired");
    const repeatSkipped = evidenceCount(res, "skipped");
    const repeatRepairedPlusSkipped = repeatRepaired === null || repeatSkipped === null
      ? null : repeatRepaired + repeatSkipped;
    const repeatPass = isRepeat && previousRecord && previousRecord.summary.contractPass === true &&
      contractPass && repeat.sameExpectedCount &&
      repeat.samePatientSet && repeat.sameMappingTuples && repeat.noPatientRegression && repeatCreated === 0 &&
      repeatRepairedPlusSkipped === scopedRows;
    const totalRetryCount = (res.retry && res.retry.schedule === true ? 1 : 0) +
      number(res.retry && res.retry.calendarFailed) + retries.length;

    return {
      summary: {
        collectorVersion: COLLECTOR_VERSION,
        importerVersion,
        readerVersion: R4_READER_VERSION,
        runNumber,
        targetDate: resultDate,
        expectedTargetDate: EXPECTED_TARGET_DATE,
        expectedScheduleRows: scheduleRows,
        expectedScopedRows: scopedRows,
        expectedPatientRows: patientRows,
        providerMode,
        requestedProviderMode: requestedProviderProof.mode,
        provenance: {
          importerVersion,
          extensionVersion,
          assetVersion,
          expectedImporterVersion: EXPECTED_IMPORTER_VERSION,
          expectedExtensionVersion: EXPECTED_EXTENSION_VERSION,
          expectedAssetVersion: EXPECTED_ASSET_VERSION,
          buildDigestEvidenceFresh: buildDigestGate,
          extensionBuildHandshakeFresh: extensionBuildMessageGate
        },
        result: { ok: res.ok === true, complete: res.complete === true, historyRequested: res.includeHistory === true },
        schedule: {
          scheduleVerified: res.scheduleVerified === true,
          complete: schedule.complete === true,
          expected: evidenceCount(schedule, "expectedCount"),
          candidates: evidenceCount(schedule, "candidateCount"),
          parsed: evidenceCount(schedule, "parsedCount"),
          merged: evidenceCount(schedule, "mergedRows"),
          unnamed: evidenceCount(schedule, "unnamedCount"),
          viewportComplete: schedule.viewportCoverageComplete === true,
          declaredCount,
          countStrategy: declaredCountStrategy,
          declaredCountAuthoritative: typeof declaredCountAuthoritative === "boolean" ? declaredCountAuthoritative : null,
          declaredCountReason,
          countProvenanceKnown,
          countProvenanceArithmetic
        },
        provider: {
          complete: provider.complete === true,
          scheduleComplete: provider.scheduleComplete === true,
          requestedProviderBound,
          sourceRows,
          providerTaggedRows: taggedRows,
          matchingRows: providerMatching,
          mismatchedRows,
          unattributedRows: evidenceCount(provider, "unattributedRows"),
          rosterComplete: providerRoster.complete === true,
          rosterPartial: providerRoster.partial === true,
          rosterExpected: rosterDeclared,
          rosterObserved,
          rosterListed,
          rosterIdentityKeysExact: attachedRosterKeysExact && liveRosterKeysExact,
          rosterFresh: attachedRosterFresh && liveRosterFresh,
          rosterOperationBound: attachedRosterOperationBound && liveRosterOperationBound,
          selectedRosterBound,
          rosterReachedEnd: providerRoster.reachedEnd === true,
          rosterReceiptAgreement: providerRosterAgreement
        },
        calendar: {
          complete: calendar.complete === true,
          attempted: evidenceCount(calendar, "attempted"),
          accounted: evidenceCount(calendar, "accounted"),
          mapped: evidenceCount(calendar, "mapped"),
          uniqueSources: evidenceCount(calendar, "uniqueSources"),
          uniqueBackend: evidenceCount(calendar, "uniqueBackend"),
          mappingComplete: calendar.mappingComplete === true,
          unresolvedMappings: evidenceCount(calendar, "unresolvedMappings"),
          created: evidenceCount(calendar, "created"),
          repaired: evidenceCount(calendar, "repaired"),
          skipped: evidenceCount(calendar, "skipped"),
          failed: evidenceCount(calendar, "failed"),
          wrongDay: evidenceCount(calendar, "wrongDay"),
          invalidDate: evidenceCount(calendar, "invalidDate"),
          snapshotPublished: calendar.snapshotPublished === true
        },
        mapping: {
          tupleCount: mappingTuples.length,
          exactFields: mappingFieldsComplete,
          exactDates: mappingDatesExact,
          uniqueSources: uniqueSourceIdentities,
          uniqueBackend: uniqueBackendAppointmentIds,
          exact: mappingTupleGate
        },
        identityBootstrap: {
          complete: identityBootstrap.complete === true,
          attempted: bootstrapAttempted,
          alreadyProven: bootstrapAlreadyProven,
          requested: bootstrapRequested,
          resolved: bootstrapResolved,
          failed: bootstrapFailed,
          appointmentBound: bootstrapAppointmentBound,
          reasonCategories: Object.keys(bootstrapReasons).length,
          proofCount: bootstrapProofs.length,
          proofsExact: bootstrapProofsExact,
          operationBound: bootstrapOperationBound,
          exact: identityBootstrapGate
        },
        canonical: {
          available: canonical.available === true,
          exact: canonical.exact === true,
          sourceCount: evidenceCount(canonical, "sourceCount"),
          activeCount: evidenceCount(canonical, "activeCount"),
          missingCount: evidenceCount(canonical, "missingCount"),
          unclassifiedCount: evidenceCount(canonical, "unclassifiedCount")
        },
        history: {
          complete: history.complete === true,
          exactIdentityVerified: history.exactIdentityVerified === true,
          historyOperationBound,
          historyNonVacuous,
          requested: evidenceCount(history, "requested"),
          processed: evidenceCount(history, "processed"),
          patientReceipts: patients.length,
          uniquePatientReceipts: Object.keys(uniquePatients).length,
          failures: evidenceCount(history, "failures"),
          retries: retries.length,
          exactIdentityCount,
          identityProofCount,
          dobProofCount,
          mrnProofCount,
          dobVerifiedPatientCount,
          completePatientCount,
          organizedPatientCount,
          organizationCompletePatientCount,
          visitsCompletePatientCount,
          visitsCoverageCompletePatientCount,
          profileCompletePatientCount,
          profileExactPatientCount,
          r4ReaderCount,
          readerVersionsObserved: Object.keys(versions).length,
          visitCountEvidenceComplete,
          expectedVisitCount,
          parsedVisitCount,
          persistedVisitCount,
          authoritativeEmptyPatientCount,
          chartReasonCounts,
          visitsReasonCounts,
          finalReasonCounts
        },
        cards,
        cardDom: domCards,
        opNote: {
          exactContexts: persisted.opNoteContextCount,
          expectedContexts: patientRows
        },
        integrity: persisted,
        totals: {
          failures: number(calendar.failed) + number(history.failures),
          retries: totalRetryCount
        },
        gates: {
          versions: versionGate,
          buildDigest: buildDigestGate,
          date: dateGate,
          monthManifest: monthManifestGate,
          result: resultGate,
          schedule: scheduleGate,
          provider: providerGate,
          providerRoster: providerRosterGate,
          identityBootstrap: identityBootstrapGate,
          mapping: mappingTupleGate,
          calendar: calendarGate,
          canonical: canonicalGate,
          cohort: cohortGate,
          history: historyGate,
          cardModel: cardModelGate,
          cardDom: cardDomGate,
          cards: cardGate,
          opNote: opNoteGate,
          integrity: integrityGate
        },
        isRepeat,
        sameScopeAsPrevious: sameScope,
        sameExpectedCount: repeat.sameExpectedCount,
        samePatientSet: repeat.samePatientSet,
        sameMappingTuples: repeat.sameMappingTuples,
        noPatientRegression: repeat.noPatientRegression,
        repeatCreated,
        repeatRepairedPlusSkipped,
        repeatPass,
        contractPass
      },
      facts: operationFacts
    };
  }

  function privateScopeKey(result, options) {
    const res = result && typeof result === "object" ? result : {};
    const requested = requestedProvider(options || {});
    const providerKey = requested.mode === "selected"
      ? String(requested.id || requested.stableKey || "unbound-selected") : "all";
    return String(res.target || "") + "|" + providerKey + "|" + ((options && options.includeHistory === false) ? "0" : "1");
  }

  function monthHookIntact() {
    return originalPullMonth ? api.pullMonth === wrappedPullMonth : typeof api.pullMonth !== "function";
  }

  /* ---- month-route certification -----------------------------------------
     A month pass is REAL evidence, never "the function returned". The month
     receipt must enumerate every calendar day of the requested month exactly
     once, every day must carry its own complete verified day receipt (its own
     schedule receipt with a unique frozen requestId, a batch-bound provider
     roster receipt for that exact day, complete calendar/bootstrap/history
     evidence), and the month totals must reconcile arithmetically with the
     per-day receipts. Any shortfall latches everMonthFailed. */
  const monthRecords = [];
  let everMonthFailed = false;
  const monthDayKeys = month => {
    const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return [];
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return [];
    const out = [];
    const cursor = new Date(Date.UTC(year, monthIndex, 1));
    while (cursor.getUTCMonth() === monthIndex) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  };
  function summarizeMonth(result, options, monthStartedAt) {
    const res = result && typeof result === "object" ? result : {};
    const totals = res.totals && typeof res.totals === "object" ? res.totals : {};
    const days = array(res.days);
    const requested = requestedProvider(options || {});
    const month = String(options && options.month || "");
    const includeHistory = !(options && options.includeHistory === false);
    const expectedDays = monthDayKeys(month);
    const dayDates = days.map(day => String(day && day.date || ""));
    const scheduleRequestIds = Object.create(null);
    let sumCreated = 0, sumRepaired = 0, sumSkipped = 0, sumAttempted = 0, sumAccounted = 0;
    let sumHistoriesRequested = 0, sumHistoriesProcessed = 0;
    let completeDayCount = 0;
    const dayGates = days.map(day => {
      const receipt = day && day.receipt && typeof day.receipt === "object" ? day.receipt : {};
      const schedule = receipt.scheduleReceipt && typeof receipt.scheduleReceipt === "object" ? receipt.scheduleReceipt : {};
      const roster = receipt.providerRosterReceipt && typeof receipt.providerRosterReceipt === "object" ? receipt.providerRosterReceipt : {};
      const calendar = receipt.calendarReceipt && typeof receipt.calendarReceipt === "object" ? receipt.calendarReceipt : {};
      const history = receipt.historyReceipt && typeof receipt.historyReceipt === "object" ? receipt.historyReceipt : {};
      const bootstrap = receipt.identityBootstrapReceipt && typeof receipt.identityBootstrapReceipt === "object" ? receipt.identityBootstrapReceipt : {};
      const dayDate = String(day && day.date || "");
      const scheduleRequestId = String(schedule.requestId || "").trim();
      const uniqueRequest = !!scheduleRequestId && !scheduleRequestIds[scheduleRequestId];
      if (scheduleRequestId) scheduleRequestIds[scheduleRequestId] = true;
      const calendarComplete = calendar.complete === true;
      sumCreated += number(receipt.created); sumRepaired += number(receipt.repaired); sumSkipped += number(receipt.skipped);
      sumAttempted += number(calendar.attempted); sumAccounted += number(calendar.accounted);
      sumHistoriesRequested += number(history.requested); sumHistoriesProcessed += number(history.processed);
      const rosterAt = capturedAt(roster.updatedAt);
      const rosterBound = String(roster.targetDate || "") === dayDate &&
        String(roster.requestId || "").trim() === scheduleRequestId &&
        String(roster.providerMode || "").toLowerCase() === requested.mode &&
        (requested.mode === "all"
          ? (!String(roster.requestedProviderId || "") && !String(roster.requestedProviderStableKey || ""))
          : (!!(String(roster.requestedProviderId || "") || String(roster.requestedProviderStableKey || "")) &&
             (!requested.id || String(roster.requestedProviderId || "") === requested.id) &&
             (!requested.stableKey || String(roster.requestedProviderStableKey || "") === requested.stableKey))) &&
        rosterAt >= monthStartedAt && rosterAt <= Date.now() + 5000;
      const bootstrapProofCount = Array.isArray(bootstrap.proofs) ? bootstrap.proofs.length : -1;
      const bootstrapOk = !includeHistory || (bootstrap.complete === true &&
        evidenceCount(bootstrap, "failed") === 0 && bootstrapProofCount === number(bootstrap.resolved));
      const historyOk = !includeHistory || (history.complete === true && history.exactIdentityVerified === true &&
        evidenceCount(history, "failures") === 0 &&
        evidenceCount(history, "requested") !== null &&
        evidenceCount(history, "processed") === evidenceCount(history, "requested"));
      const pass = !!(day && day.ok === true && day.complete === true && /^\d{4}-\d{2}-\d{2}$/.test(dayDate) &&
        receipt.ok === true && receipt.complete === true && String(receipt.target || "") === dayDate &&
        schedule.complete === true && uniqueRequest && calendarComplete &&
        roster.complete === true && roster.partial !== true && rosterBound &&
        bootstrapOk && historyOk);
      if (pass) completeDayCount++;
      return pass;
    });
    const totalsExact =
      evidenceCount(totals, "days") === expectedDays.length &&
      evidenceCount(totals, "completeDays") === expectedDays.length &&
      evidenceCount(totals, "failures") === 0 &&
      number(totals.scheduleAttempted) === sumAttempted &&
      number(totals.scheduleAccounted) === sumAccounted &&
      sumAccounted === sumAttempted &&
      number(totals.created) === sumCreated &&
      number(totals.repaired) === sumRepaired &&
      number(totals.skipped) === sumSkipped &&
      number(totals.historiesRequested) === sumHistoriesRequested &&
      number(totals.historiesProcessed) === sumHistoriesProcessed &&
      (!includeHistory || sumHistoriesProcessed === sumHistoriesRequested);
    const monthPass = res.ok === true && res.complete === true && String(res.reason || "") === "complete" &&
      includeHistory && res.includeHistory === true &&
      expectedDays.length > 0 && days.length === expectedDays.length &&
      sameStrings(dayDates, expectedDays) && nonblankUniqueStrings(dayDates) &&
      dayGates.every(gate => gate === true) && completeDayCount === expectedDays.length &&
      array(res.retry && res.retry.dates).length === 0 && totalsExact &&
      (requested.mode === "all" || requested.mode === "selected");
    return {
      collectorVersion: COLLECTOR_VERSION,
      kind: "month-route",
      month,
      requestedProviderMode: requested.mode,
      includeHistory,
      expectedDayCount: expectedDays.length,
      dayCount: days.length,
      completeDayCount,
      uniqueScheduleRequestIds: Object.keys(scheduleRequestIds).length,
      totals: {
        scheduleAttempted: sumAttempted,
        scheduleAccounted: sumAccounted,
        historiesRequested: sumHistoriesRequested,
        historiesProcessed: sumHistoriesProcessed,
        created: sumCreated,
        repaired: sumRepaired,
        skipped: sumSkipped
      },
      totalsExact,
      retryDates: array(res.retry && res.retry.dates).length,
      monthPass
    };
  }

  function safeStatus() {
    if (!monthHookIntact()) uncertifiedMonthObserved = true;
    return {
      installed: api.pull === wrappedPull && monthHookIntact(),
      runCount: records.length,
      collectorVersion: COLLECTOR_VERSION,
      importerVersion: String(api.version || "0.0.0"),
      readerVersion: R4_READER_VERSION,
      expectedTargetDate: EXPECTED_TARGET_DATE,
      monthRunCount: monthRecords.length,
      monthCertified: monthRecords.length > 0 && !everMonthFailed && !uncertifiedMonthObserved,
      uncertifiedMonthObserved
    };
  }

  function publish(value) {
    try {
      let node = document.getElementById(RECEIPT_NODE_ID);
      if (!node) {
        node = document.createElement("pre");
        node.id = RECEIPT_NODE_ID;
        node.hidden = true;
        (document.documentElement || document.body).appendChild(node);
      }
      node.textContent = JSON.stringify(value);
    } catch (_) {}
  }

  function wrappedPull(options) {
    const pullStartedAt = Date.now();
    const prePullFacts = snapshotLocalBeforePull();
    if (options && (options.scope === "month" || options.mode === "month" || options.month)) uncertifiedMonthObserved = true;
    try { window.postMessage({ source: "mls-app", type: "mlsPing", acceptanceProbe: COLLECTOR_VERSION }, "*"); } catch (_) {}
    return Promise.resolve(originalPull.call(api, options)).then(async result => {
      const scopeKey = privateScopeKey(result, options || {});
      const previous = records.length ? records[records.length - 1] : null;
      const built = await summarize(result, options || {}, records.length + 1, scopeKey, previous, pullStartedAt, prePullFacts);
      if (built.summary.gates.monthManifest !== true) uncertifiedMonthObserved = true;
      if (built.summary.isRepeat === true && built.summary.repeatPass !== true) everRepeatFailed = true;
      built.summary.everRepeatFailed = everRepeatFailed;
      records.push({ scopeKey, summary: built.summary, facts: built.facts });
      const prior = records.length > 1 ? records[records.length - 2] : null;
      built.summary.finalContractPass = !!(!everRepeatFailed && !uncertifiedMonthObserved && prior && prior.summary.contractPass === true && built.summary.repeatPass === true);
      publish(built.summary);
      return result;
    });
  }

  function wrappedPullMonth(options) {
    const monthStartedAt = Date.now();
    return Promise.resolve(originalPullMonth.apply(api, arguments)).then(result => {
      const built = summarizeMonth(result, options || {}, monthStartedAt);
      if (built.monthPass !== true) everMonthFailed = true;
      monthRecords.push(built);
      publish(built);
      return result;
    }, error => {
      everMonthFailed = true;
      monthRecords.push({ collectorVersion: COLLECTOR_VERSION, kind: "month-route", monthPass: false, failedWith: "exception" });
      publish(safeStatus());
      throw error;
    });
  }

  Object.defineProperty(wrappedPull, "__mlsPhiFreeAcceptanceWrapped", { value: true });
  Object.defineProperty(wrappedPull, "__mlsPhiFreeAcceptanceVersion", { value: COLLECTOR_VERSION });
  api.pull = wrappedPull;
  if (originalPullMonth) {
    Object.defineProperty(wrappedPullMonth, "__mlsPhiFreeAcceptanceWrapped", { value: true });
    Object.defineProperty(wrappedPullMonth, "__mlsPhiFreeAcceptanceVersion", { value: COLLECTOR_VERSION });
    api.pullMonth = wrappedPullMonth;
  }

  window.__mlsPhiFreeAcceptance = Object.freeze({
    status() { return clone(safeStatus()); },
    latest() {
      return records.length ? clone(records[records.length - 1].summary) : Object.assign({ available: false }, safeStatus());
    },
    results() { return records.map(record => clone(record.summary)); },
    monthResults() { return monthRecords.map(record => clone(record)); },
    verdict() {
      if (!monthHookIntact()) uncertifiedMonthObserved = true;
      const runCount = records.length;
      const previous = runCount > 1 ? records[runCount - 2] : null;
      const latest = runCount ? records[runCount - 1] : null;
      const repeatObserved = !!(runCount > 1 && latest && latest.summary.isRepeat === true);
      const out = {
        collectorVersion: COLLECTOR_VERSION,
        importerVersion: String(api.version || "0.0.0"),
        readerVersion: R4_READER_VERSION,
        runCount,
        firstRunPass: !!(previous && previous.summary.contractPass === true),
        repeatObserved,
        sameScope: !!(latest && latest.summary.sameScopeAsPrevious === true),
        sameExpectedCount: !!(latest && latest.summary.sameExpectedCount === true),
        samePatientSet: !!(latest && latest.summary.samePatientSet === true),
        sameMappingTuples: !!(latest && latest.summary.sameMappingTuples === true),
        noPatientRegression: !!(latest && latest.summary.noPatientRegression === true),
        repeatCreated: latest ? latest.summary.repeatCreated : null,
        repeatRepairedPlusSkipped: latest ? latest.summary.repeatRepairedPlusSkipped : null,
        repeatPass: !!(latest && latest.summary.repeatPass === true),
        monthRunCount: monthRecords.length,
        everMonthFailed,
        monthCertified: monthRecords.length > 0 && !everMonthFailed && !uncertifiedMonthObserved && monthHookIntact(),
        uncertifiedMonthObserved,
        monthHookIntact: monthHookIntact()
      };
      out.everRepeatFailed = everRepeatFailed;
      out.contractPass = !everRepeatFailed && !uncertifiedMonthObserved && out.firstRunPass && out.repeatPass;
      return out;
    }
  });

  publish(safeStatus());
  return window.__mlsPhiFreeAcceptance.status();
})();
