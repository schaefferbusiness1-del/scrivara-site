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
  });
  const started = Date.now();
  await action();
  await wait(settleMs || 700);
  const result = await page.evaluate(() => {
    const tasks = window.__perfProbe.longTasks.slice();
    return {
      longTaskCount: tasks.length,
      longTaskMs: Math.round(tasks.reduce((sum, item) => sum + item.duration, 0) * 10) / 10,
      maxLongTaskMs: Math.round(tasks.reduce((max, item) => Math.max(max, item.duration), 0) * 10) / 10,
      mutations: window.__perfProbe.mutations,
      domNodes: document.getElementsByTagName('*').length
    };
  });
  result.label = label;
  result.wallMs = Date.now() - started;
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
      window.__perfProbe = { longTasks: [], observers: 0, intervals: 0, mutations: 0 };
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
        startupPending: Number(document.documentElement.dataset.mlsStartupAllPending || 0)
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

    const samples = [login];
    samples.push(await measure(page, 'open-patients', () => page.evaluate(() => showView('patients')), 1000));
    samples.push(await measure(page, 'select-patient', () => page.evaluate(() => selectPatient('perf-p-149')), 700));
    samples.push(await measure(page, 'switch-patient', () => page.evaluate(() => selectPatient('perf-p-148')), 700));
    samples.push(await measure(page, 'rerender-patients', () => page.evaluate(() => renderPatients()), 700));
    samples.push(await measure(page, 'search-patients', () => page.evaluate(() => {
      document.getElementById('ptSearch').value = '1499';
      renderPatients();
    }), 700));
    samples.push(await measure(page, 'open-calendar', () => page.evaluate(() => {
      document.getElementById('ptSearch').value = '';
      showView('calendar');
    }), 1600));
    samples.push(await measure(page, 'rerender-calendar', () => page.evaluate(() => renderCalendar()), 800));
    samples.push(await measure(page, 'calendar-next-month', () => page.evaluate(() => calNext()), 800));
    samples.push(await measure(page, 'calendar-to-patients', () => page.evaluate(() => showView('patients')), 1000));
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
