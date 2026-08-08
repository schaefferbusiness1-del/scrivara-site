'use strict';

/* Reproducible foreground benchmark for the two active-patient safety helpers.
 * It executes the real feature files against a 100,000-patient account and a
 * synthetic route DOM. The deterministic clock measures user-visible selection
 * convergence; CPU timings measure idle work and a route click that lands on a
 * timer boundary. No network, real account, extension, or PHI is involved.
 *
 * Usage:
 *   node scripts/benchmark-active-patient-interaction.js [baseline-ref-or-dir] [candidate-dir]
 *
 * Defaults compare the b924 integration base with the current worktree. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');

const repoRoot = path.resolve(__dirname, '..');
const baselineSpec = process.argv[2] || '50a5243ea619fa78ae092ca693a538775d524744';
const candidateSpec = process.argv[3] || repoRoot;
const patientCount = Math.max(1000, Number(process.env.MLS_BENCH_PATIENTS) || 100000);
const routeSamples = Math.max(5, Number(process.env.MLS_BENCH_SAMPLES) || 31);

function readSource(spec, file) {
  const resolved = path.resolve(spec);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return fs.readFileSync(path.join(resolved, file), 'utf8');
  }
  return execFileSync('git', ['show', `${spec}:${file}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
}

function eventTarget(target) {
  const listeners = Object.create(null);
  target.addEventListener = function (name, fn) {
    (listeners[name] || (listeners[name] = [])).push(fn);
  };
  target.removeEventListener = function (name, fn) {
    listeners[name] = (listeners[name] || []).filter(item => item !== fn);
  };
  target.emit = function (name, event) {
    (listeners[name] || []).slice().forEach(fn => fn(event || { type: name }));
  };
  return target;
}

function scheduler() {
  let now = 0;
  let nextId = 0;
  let intervalCreates = 0;
  let intervalRuns = 0;
  const jobs = new Map();
  function setInterval(fn, ms) {
    const id = ++nextId;
    const delay = Math.max(1, Number(ms) || 1);
    jobs.set(id, { fn, delay, next: now + delay, repeat: true });
    intervalCreates++;
    return id;
  }
  function setTimeout(fn, ms) {
    const id = ++nextId;
    const delay = Math.max(0, Number(ms) || 0);
    jobs.set(id, { fn, delay, next: now + delay, repeat: false });
    return id;
  }
  function clear(id) { jobs.delete(id); }
  function advanceTo(target) {
    while (true) {
      let id = null;
      let due = Infinity;
      for (const [candidateId, job] of jobs) {
        if (job.next < due) { id = candidateId; due = job.next; }
      }
      if (id == null || due > target) break;
      now = due;
      const job = jobs.get(id);
      if (!job) continue;
      if (job.repeat) job.next += job.delay;
      else jobs.delete(id);
      if (job.repeat) intervalRuns++;
      job.fn();
    }
    now = target;
  }
  return {
    setInterval, clearInterval: clear, setTimeout, clearTimeout: clear, advanceTo,
    get now() { return now; },
    get intervalCreates() { return intervalCreates; },
    get intervalRuns() { return intervalRuns; }
  };
}

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

function buildRuntime(sources) {
  const clock = scheduler();
  const patients = Array.from({ length: patientCount }, (_, index) => ({
    id: `p-${index}`,
    name: `Benchmark Patient ${String(index).padStart(6, '0')}`,
    dob: `01/01/${1940 + (index % 60)}`
  }));
  let activeId = patients[0].id;
  let patientReads = 0;
  let fieldWrites = 0;
  const fields = {
    heroPtName: { value: patients[0].name, dispatchEvent() {} },
    patientLabel: { value: patients[0].name, dispatchEvent() {} }
  };
  for (const field of Object.values(fields)) {
    let value = field.value;
    Object.defineProperty(field, 'value', {
      get() { return value; },
      set(next) { fieldWrites++; value = String(next); }
    });
  }
  const routeNodes = Array.from({ length: 24 }, () => ({ display: 'none', selected: false }));
  const document = eventTarget({
    readyState: 'complete', activeElement: null,
    querySelector() { return null; },
    getElementById(id) { return fields[id] || null; },
    createElement() { return { appendChild() {}, setAttribute() {} }; }
  });
  const localStorage = storage();
  const location = { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' };
  const window = eventTarget({
    document, localStorage, location,
    _copilotHistory: [{ role: 'user', text: 'Synthetic conversation' }],
    uns(key) { return `sf_u::benchmark@example.test::${key}`; },
    getActivePtId() { return activeId; },
    activePatient() {
      patientReads++;
      for (let i = 0; i < patients.length; i++) if (patients[i].id === activeId) return patients[i];
      return null;
    },
    findPatient(id) {
      for (let i = 0; i < patients.length; i++) if (patients[i].id === id) return patients[i];
      return null;
    },
    _copilotSaveHist() {}, _copilotRenderThread() {}, _copilotRenderChips() {}
  });
  window.window = window;
  const context = vm.createContext({
    window, document, localStorage, location, console,
    Event: function Event(type) { this.type = type; },
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
  });
  vm.runInContext(sources.active, context, { filename: 'feat_mls_active_patient_sync.js' });
  vm.runInContext(sources.context, context, { filename: 'feat_mls_patient_context_safety.js' });

  function chooseLastPatient() {
    const previousId = activeId;
    activeId = patients[patients.length - 1].id;
    window.emit('mls:active-patient-changed', { detail: { previousId, patientId: activeId } });
  }
  function consistent() {
    const fieldReady = fields.heroPtName.value === patients[patients.length - 1].name &&
      fields.patientLabel.value === patients[patients.length - 1].name;
    const api = window.__mlsPtCtxSafety;
    return fieldReady && api && api.owner() === activeId;
  }
  function routeWrite() {
    for (let i = 0; i < routeNodes.length; i++) {
      routeNodes[i].display = i === 7 ? 'block' : 'none';
      routeNodes[i].selected = i === 7;
    }
  }
  return {
    clock, window, chooseLastPatient, consistent, routeWrite,
    get patientReads() { return patientReads; },
    get fieldWrites() { return fieldWrites; }
  };
}

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}
function round(value, digits) {
  const scale = Math.pow(10, digits == null ? 3 : digits);
  return Math.round(value * scale) / scale;
}

function measure(label, spec) {
  const sources = {
    active: readSource(spec, 'feat_mls_active_patient_sync.js'),
    context: readSource(spec, 'feat_mls_patient_context_safety.js')
  };

  const selection = buildRuntime(sources);
  selection.chooseLastPatient();
  let selectionMs = 0;
  while (!selection.consistent() && selectionMs < 2000) {
    selectionMs++;
    selection.clock.advanceTo(selectionMs);
  }

  const idle = buildRuntime(sources);
  idle.chooseLastPatient();
  const idleStart = performance.now();
  idle.clock.advanceTo(60000);
  const idleCpuMs = performance.now() - idleStart;

  const route = buildRuntime(sources);
  route.chooseLastPatient();
  const samples = [];
  for (let i = 0; i < routeSamples; i++) {
    const target = route.clock.now + 1200; // both legacy 400/600 ms polls collide here
    const started = performance.now();
    route.clock.advanceTo(target);
    route.routeWrite();
    samples.push(performance.now() - started);
  }

  return {
    label,
    spec: path.resolve(spec) === spec ? spec : String(spec),
    patientCount,
    permanentIntervals: idle.clock.intervalCreates,
    selectionConsistencyMs: selection.consistent() ? selectionMs : null,
    sixtySecondIdle: {
      intervalCallbacks: idle.clock.intervalRuns,
      patientStoreReads: idle.patientReads,
      cpuMs: round(idleCpuMs)
    },
    routeClickAtLegacyTimerBoundary: {
      samples: routeSamples,
      medianCpuMs: round(percentile(samples, 0.5), 6),
      p95CpuMs: round(percentile(samples, 0.95), 6),
      patientStoreReads: route.patientReads
    }
  };
}

const baseline = measure('baseline', baselineSpec);
const candidate = measure('candidate', candidateSpec);
const improvement = {
  permanentIntervalsRemoved: baseline.permanentIntervals - candidate.permanentIntervals,
  selectionConsistencyMsSaved: baseline.selectionConsistencyMs - candidate.selectionConsistencyMs,
  idleCpuReductionPct: baseline.sixtySecondIdle.cpuMs > 0
    ? round((baseline.sixtySecondIdle.cpuMs - candidate.sixtySecondIdle.cpuMs) / baseline.sixtySecondIdle.cpuMs * 100)
    : null,
  routeMedianReductionPct: baseline.routeClickAtLegacyTimerBoundary.medianCpuMs > 0
    ? round((baseline.routeClickAtLegacyTimerBoundary.medianCpuMs - candidate.routeClickAtLegacyTimerBoundary.medianCpuMs) / baseline.routeClickAtLegacyTimerBoundary.medianCpuMs * 100)
    : null
};

process.stdout.write(JSON.stringify({ baseline, candidate, improvement }, null, 2) + '\n');
