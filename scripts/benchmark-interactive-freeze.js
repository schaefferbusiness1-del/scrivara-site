'use strict';

/* Manual foreground performance probe for the real local/demo app.
 *
 * Usage:
 *   NODE_PATH=<bundled node_modules> node scripts/benchmark-interactive-freeze.js <site-root> [port]
 *
 * It never contacts Athena or a hosted account. The browser gets a fresh local
 * profile, signs into the synthetic demo backend, seeds a 1,500-patient roster,
 * and measures the login cover plus Patients/Calendar main-thread work. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const port = Number(process.argv[3] || 8891);
const profileOnly = process.argv.includes('--profile');
const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find(file => fs.existsSync(file));
if (!chrome) throw new Error('Chrome is not installed at a standard path');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(String(req.url || '/').split('?')[0]);
  const relative = pathname === '/' ? 'ScribeFlow.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (error, body) => {
    if (error) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  });
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForApp(page, timeoutMs) {
  await page.waitForFunction(() => {
    const app = document.getElementById('appScreen');
    const gate = document.getElementById('sfGateLoading');
    return !!(app && app.style.display !== 'none' &&
      window.sfGateLoadingVisible === false &&
      (!gate || gate.style.display === 'none'));
  }, null, { timeout: timeoutMs });
}

async function measure(page, label, action, settleMs) {
  await page.evaluate(() => {
    window.__perfProbe.longTasks.length = 0;
    window.__perfProbe.mutations = 0;
    window.__perfProbe.activePatientListeners.length = 0;
    window.__perfProbe.animationFrames.length = 0;
    window.__perfProbe.measureStarted = performance.now();
  });
  const started = Date.now();
  const actionResult = await action();
  await wait(settleMs || 700);
  const result = await page.evaluate(() => {
    const tasks = window.__perfProbe.longTasks.slice();
    const measureStarted = window.__perfProbe.measureStarted || 0;
    return {
      longTaskCount: tasks.length,
      longTaskMs: Math.round(tasks.reduce((sum, item) => sum + item.duration, 0) * 10) / 10,
      maxLongTaskMs: Math.round(tasks.reduce((max, item) => Math.max(max, item.duration), 0) * 10) / 10,
      longTasks: tasks.map(item => ({ offset: Math.round((item.startTime - measureStarted) * 10) / 10, duration: Math.round(item.duration * 10) / 10 })),
      mutations: window.__perfProbe.mutations,
      domNodes: document.getElementsByTagName('*').length,
      activePatientListeners: window.__perfProbe.activePatientListeners.slice().sort((a, b) => b.duration - a.duration),
      animationFrames: window.__perfProbe.animationFrames.filter(item => item.duration >= 1).sort((a, b) => b.duration - a.duration).slice(0, 20)
    };
  });
  result.label = label;
  result.wallMs = Date.now() - started;
  if (actionResult !== undefined) result.action = actionResult;
  return result;
}

(async () => {
  await new Promise(resolve => server.listen(port, resolve));
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: false,
    args: ['--no-first-run', '--disable-extensions', '--mute-audio', '--window-size=1280,850']
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__perfProbe = { longTasks: [], observers: 0, intervals: 0, mutations: 0, activePatientListeners: [], animationFrames: [], measureStarted: 0 };
      try {
        const nativeFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = function (callback) {
          const registered = String(new Error().stack || '').split('\n').slice(2, 4).join(' | ');
          return nativeFrame(function (stamp) {
            const started = performance.now();
            try { return callback(stamp); }
            finally {
              window.__perfProbe.animationFrames.push({
                name: callback.name || '(anonymous)',
                source: registered,
                duration: Math.round((performance.now() - started) * 100) / 100
              });
            }
          });
        };
      } catch (error) {}
      try {
        const nativeAdd = window.addEventListener.bind(window);
        const nativeRemove = window.removeEventListener.bind(window);
        const activeWrappers = new WeakMap();
        window.addEventListener = function (type, listener, options) {
          if (type !== 'mls:active-patient-changed' || typeof listener !== 'function') return nativeAdd(type, listener, options);
          let wrapped = activeWrappers.get(listener);
          if (!wrapped) {
            wrapped = function () {
              const started = performance.now();
              try { return listener.apply(this, arguments); }
              finally {
                window.__perfProbe.activePatientListeners.push({
                  name: listener.name || '(anonymous)',
                  duration: Math.round((performance.now() - started) * 100) / 100
                });
              }
            };
            activeWrappers.set(listener, wrapped);
          }
          return nativeAdd(type, wrapped, options);
        };
        window.removeEventListener = function (type, listener, options) {
          const wrapped = type === 'mls:active-patient-changed' && typeof listener === 'function' ? activeWrappers.get(listener) : null;
          return nativeRemove(type, wrapped || listener, options);
        };
      } catch (error) {}
      try {
        const NativeObserver = window.MutationObserver;
        window.MutationObserver = function (callback) {
          window.__perfProbe.observers++;
          return new NativeObserver(function (records, observer) {
            window.__perfProbe.mutations += records.length;
            return callback(records, observer);
          });
        };
        window.MutationObserver.prototype = NativeObserver.prototype;
      } catch (error) {}
      try {
        const nativeInterval = window.setInterval;
        window.setInterval = function () {
          window.__perfProbe.intervals++;
          return nativeInterval.apply(this, arguments);
        };
      } catch (error) {}
      try {
        new PerformanceObserver(list => {
          list.getEntries().forEach(entry => {
            window.__perfProbe.longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration
            });
          });
        }).observe({ type: 'longtask', buffered: true });
      } catch (error) {}
    });

    await page.goto(`http://localhost:${port}/ScribeFlow.html?demo=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.bringToFront();
    await page.waitForSelector('#authScreen', { state: 'visible', timeout: 15000 });
    await page.evaluate(() => switchAuth('signup'));
    await wait(700);
    await page.evaluate(() => {
      const email = document.getElementById('authEmail');
      const pass = document.getElementById('authPass');
      const pass2 = document.getElementById('authPass2');
      if (email) email.value = 'perf-' + Date.now() + '@example.test';
      if (pass) pass.value = 'perf-password-1';
      if (pass2) pass2.value = 'perf-password-1';
      document.querySelectorAll('#authScreen input[type="checkbox"]').forEach(box => {
        if (!box.checked) box.click();
      });
      window.__perfProbe.longTasks.length = 0;
      window.__perfProbe.loginStarted = performance.now();
      doAuth();
    });

    for (let i = 0; i < 30; i++) {
      const visible = await page.evaluate(() => {
        const app = document.getElementById('appScreen');
        return !!(app && app.style.display !== 'none');
      });
      if (visible) break;
      await page.evaluate(() => {
        document.querySelectorAll('input[type="checkbox"]').forEach(box => {
          if (!box.checked && box.offsetParent !== null) box.click();
        });
        const buttons = Array.from(document.querySelectorAll('button,a')).filter(node => node.offsetParent !== null);
        const accept = buttons.find(node => /agree|accept|continue|confirm/i.test(node.textContent || ''));
        if (accept) accept.click();
        try { doAuth(); } catch (error) {}
      });
      await wait(250);
    }
    try {
      await waitForApp(page, 60000);
    } catch (error) {
      const state = await page.evaluate(() => {
        const app = document.getElementById('appScreen');
        const auth = document.getElementById('authScreen');
        const gate = document.getElementById('sfGateLoading');
        return {
          appDisplay: app && app.style.display,
          authDisplay: auth && auth.style.display,
          gateDisplay: gate && gate.style.display,
          gateVisible: window.sfGateLoadingVisible,
          gateMessage: (document.getElementById('mlsBLmsg') || {}).textContent || '',
          bundleReady: window.__mlsUiBundleReady,
          bundleFailed: window.__mlsUiBundleFailed,
          bundleReason: (window.__mlsStartupAssets || {}).reason || '',
          pending: (window.__mlsStartupAssets || {}).allPendingAtPublish
        };
      });
      throw new Error(error.message + '\nstate=' + JSON.stringify(state));
    }
    const login = await page.evaluate(() => {
      const tasks = window.__perfProbe.longTasks.filter(task => task.startTime >= window.__perfProbe.loginStarted);
      return {
        label: 'login-gate',
        wallMs: Math.round(performance.now() - window.__perfProbe.loginStarted),
        longTaskCount: tasks.length,
        longTaskMs: Math.round(tasks.reduce((sum, task) => sum + task.duration, 0) * 10) / 10,
        maxLongTaskMs: Math.round(tasks.reduce((max, task) => Math.max(max, task.duration), 0) * 10) / 10,
        observers: window.__perfProbe.observers,
        intervals: window.__perfProbe.intervals,
        domNodes: document.getElementsByTagName('*').length,
        startupReason: document.documentElement.dataset.mlsStartupReason || '',
        startupPending: Number(document.documentElement.dataset.mlsStartupAllPending || 0),
        bundleReady: window.__mlsUiBundleReady,
        bundleFailed: window.__mlsUiBundleFailed,
        deferredAssets: window.__mlsDeferAsset && typeof window.__mlsDeferAsset.stats === 'function' ? window.__mlsDeferAsset.stats() : null,
        priorityAssetsLoaded: ['feat_mls_calm_shell.js', 'feat_mls_calm_views.js', 'feat_mls_ui_clinical.js', 'feat_mls_ui_shell.js', 'feat_mls_motion.js',
          'feat_mls_visit_focus.js', 'feat_mls_polish_everywhere.js', 'feat_mls_visit_voice_one.js'].reduce((state, name) => {
            state[name] = !!document.querySelector('script[data-mls-asset="' + name + '"]');
            return state;
          }, {}),
        priorityOwnersInstalled: ['__mlsCalmShell', '__mlsCalmViews', '__mlsUiClinical', '__mlsUiShell', '__mlsMotion',
          '__mlsVisitFocus', '__mlsPolishEverywhere', '__mlsVisitVoiceOne'].reduce((state, name) => {
            const owner = window[name];
            state[name] = !!(owner && owner.installed !== false);
            return state;
          }, {})
      };
    });

    await page.evaluate(() => {
      const patients = [];
      const notes = [];
      for (let i = 0; i < 1500; i++) {
        const id = 'perf-p-' + i;
        patients.push({
          id,
          name: 'Performance Patient ' + String(i).padStart(4, '0'),
          dob: '01/01/' + (1940 + (i % 60)),
          mrn: 'MRN' + String(i).padStart(6, '0'),
          problems: i % 3 ? 'Chronic pain' : 'Lumbar radiculopathy',
          docs: []
        });
        const count = i % 4;
        for (let n = 0; n < count; n++) {
          notes.push({
            id: 'perf-n-' + i + '-' + n,
            patientId: id,
            updated: 1700000000000 + i * 1000 + n,
            created: 1700000000000 + i * 1000 + n,
            note: 'Synthetic benchmark note'
          });
        }
      }
      savePatients(patients);
      saveNotes(notes);
      setActivePtId(patients[0].id);
      const appts = [];
      const now = new Date();
      for (let i = 0; i < 3000; i++) {
        const day = new Date(now.getFullYear(), now.getMonth() + ((i % 5) - 2), 1 + (i % 28), 8 + (i % 9), (i % 4) * 15);
        appts.push({
          id: i + 1,
          appointment_id: 'perf-a-' + i,
          name: patients[i % patients.length].name,
          appt_date: day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0'),
          start_at: day.toISOString(),
          status: i % 7 ? 'booked' : 'checked_in'
        });
      }
      window._calAppts = appts;
      try { _calAppts = appts; } catch (error) {}
    });

    if (profileOnly) {
      await page.evaluate(() => showView('visit'));
      await wait(150);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      const action = await page.evaluate(() => {
        const started = performance.now(); showView('patients');
        return Math.round((performance.now() - started) * 100) / 100;
      });
      const stopped = await cdp.send('Profiler.stop');
      const byId = new Map(stopped.profile.nodes.map(node => [node.id, node]));
      const selfUs = new Map();
      (stopped.profile.samples || []).forEach((id, index) => {
        selfUs.set(id, (selfUs.get(id) || 0) + Number((stopped.profile.timeDeltas || [])[index] || 0));
      });
      const hottest = [...selfUs.entries()].map(([id, us]) => {
        const node = byId.get(id) || {}, frame = node.callFrame || {};
        return { ms: Math.round(us / 10) / 100, function: frame.functionName || '(anonymous)', url: frame.url || '', line: Number(frame.lineNumber || 0) + 1 };
      }).sort((a, b) => b.ms - a.ms).slice(0, 30);
      process.stdout.write(JSON.stringify({ build: await page.evaluate(() => window.__MLS_APP_BUILD || ''), actionMs: action, hottest }, null, 2) + '\n');
      await cdp.detach();
      await context.close();
      return;
    }

    const samples = [login];
    samples.push(await measure(page, 'open-patients', () => page.evaluate(() => {
      const calls = {}, originals = {};
      ['_renderDailyBrief','renderPatientBar','updateNavCounts','renderPatients','renderProfile','loadPendingIntakes','hideClinicalForReceptionist','initCollapsibleExtras','_renderPinnedTabs'].forEach(name => {
        if (typeof window[name] !== 'function') return;
        const original = originals[name] = window[name];
        window[name] = function () {
          const began = performance.now();
          try { return original.apply(this, arguments); }
          finally { const rec = calls[name] || (calls[name] = { count: 0, ms: 0 }); rec.count++; rec.ms += performance.now() - began; }
        };
      });
      const started = performance.now(); showView('patients');
      Object.keys(originals).forEach(name => { window[name] = originals[name]; });
      Object.keys(calls).forEach(name => { calls[name].ms = Math.round(calls[name].ms * 100) / 100; });
      return { showView: Math.round((performance.now() - started) * 100) / 100, calls };
    }), 1000));
    samples.push(await measure(page, 'select-patient', () => page.evaluate(() => {
      const elapsed = {};
      const step = (name, fn) => { const started = performance.now(); fn(); elapsed[name] = Math.round((performance.now() - started) * 100) / 100; };
      step('resetSuperbill', () => _athenaResetSuperbill(true));
      step('setActive', () => setActivePtId('perf-p-149'));
      step('renderPatients', () => renderPatients());
      step('renderProfile', () => renderProfile());
      step('renderPatientBar', () => renderPatientBar());
      return elapsed;
    }), 700));
    samples.push(await measure(page, 'switch-patient', () => page.evaluate(() => {
      const elapsed = {};
      const step = (name, fn) => { const started = performance.now(); fn(); elapsed[name] = Math.round((performance.now() - started) * 100) / 100; };
      step('resetSuperbill', () => _athenaResetSuperbill(true));
      step('setActive', () => setActivePtId('perf-p-148'));
      step('renderPatients', () => renderPatients());
      step('renderProfile', () => renderProfile());
      step('renderPatientBar', () => renderPatientBar());
      return elapsed;
    }), 700));
    samples.push(await measure(page, 'rerender-patients', () => page.evaluate(() => renderPatients()), 700));
    samples.push(await measure(page, 'search-patients', () => page.evaluate(() => {
      document.getElementById('ptSearch').value = '1499';
      renderPatients();
    }), 700));
    samples.push(await measure(page, 'open-calendar', () => page.evaluate(() => {
      const calls = {}, originals = {};
      ['loadCalendar','renderCalendar','renderCalCheckin','renderPatientBar','updateNavCounts','initCollapsibleExtras'].forEach(name => {
        if (typeof window[name] !== 'function') return;
        const original = originals[name] = window[name];
        window[name] = function () {
          const began = performance.now();
          try { return original.apply(this, arguments); }
          finally { const rec = calls[name] || (calls[name] = { count: 0, ms: 0 }); rec.count++; rec.ms += performance.now() - began; }
        };
      });
      const started = performance.now();
      document.getElementById('ptSearch').value = '';
      showView('calendar');
      Object.keys(originals).forEach(name => { window[name] = originals[name]; });
      Object.keys(calls).forEach(name => { calls[name].ms = Math.round(calls[name].ms * 100) / 100; });
      return { showView: Math.round((performance.now() - started) * 100) / 100, calls };
    }), 1600));
    samples.push(await measure(page, 'rerender-calendar', () => page.evaluate(() => renderCalendar()), 800));
    samples.push(await measure(page, 'calendar-next-month', () => page.evaluate(() => calNext()), 800));
    samples.push(await measure(page, 'calendar-to-patients', () => page.evaluate(() => {
      const started = performance.now(); showView('patients');
      return { showView: Math.round((performance.now() - started) * 100) / 100 };
    }), 1000));
    samples.push(await measure(page, 'idle-two-seconds', () => Promise.resolve(), 2000));

    process.stdout.write(JSON.stringify({
      root,
      build: await page.evaluate(() => window.__MLS_APP_BUILD || ''),
      samples
    }, null, 2) + '\n');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  try { server.close(); } catch (closeError) {}
  process.exit(1);
});
