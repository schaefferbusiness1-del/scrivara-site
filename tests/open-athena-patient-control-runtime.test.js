'use strict';

/* Regression for the live Patients-page disappearance. The real visibility
 * owner is exercised in Chromium with no Athena traffic and synthetic state
 * only. It must show exactly one open-Athena action when connected, and fail
 * closed during unavailable, in-flight, recording and explicit identity-
 * unsafe states. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const pullOneMarker = shell.indexOf('<!-- ===== pullone-1.0.0');
const pullOneScriptStart = shell.indexOf('<script>', pullOneMarker);
const pullOneScriptEnd = shell.indexOf('</script>', pullOneScriptStart);
assert(pullOneMarker >= 0 && pullOneScriptStart > pullOneMarker && pullOneScriptEnd > pullOneScriptStart,
  'could not extract the shipped PullOne status owner');
const pullOneSource = shell.slice(pullOneScriptStart + '<script>'.length, pullOneScriptEnd);
const pullVerbMarker = shell.indexOf('<!-- ===== pullverb-1.0.0');
const pullVerbScriptStart = shell.indexOf('<script>', pullVerbMarker);
const pullVerbScriptEnd = shell.indexOf('</script>', pullVerbScriptStart);
assert(pullVerbMarker >= 0 && pullVerbScriptStart > pullVerbMarker && pullVerbScriptEnd > pullVerbScriptStart,
  'could not extract the shipped PullVerb owner');
const pullVerbSource = shell.slice(pullVerbScriptStart + '<script>'.length, pullVerbScriptEnd);
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const panelDriverStart = backgroundSource.indexOf('/* === MLS Assist v1.36');
const panelDriverEndMarker = '\n})();';
const panelDriverEnd = backgroundSource.indexOf(panelDriverEndMarker, panelDriverStart);
assert(panelDriverStart >= 0 && panelDriverEnd > panelDriverStart,
  'could not extract the shipped extension-panel pull driver');
const panelDriverSource = backgroundSource.slice(panelDriverStart, panelDriverEnd + panelDriverEndMarker.length);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  });
  try {
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box} body{margin:0;font:14px system-ui}
      #patientsView{display:block;padding:12px}
      #patientTools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:100%}
      button{max-width:100%;white-space:normal}
    </style></head><body><main id="patientsView"><div id="patientTools">
      <button id="ptNewBtn">New patient</button>
      <button id="ptPullAthenaBtn" hidden style="display:none!important" data-mls-pullverb="open-in-athena" data-mls-open-patient-owner="feat-visits-v2"
        onclick="pullPatientFromAthenaPrompt(this)">Pull the open patient in athena</button>
      <button id="ptMoreBtn">More</button>
    </div><section id="profileCard"><div id="mlsVisitHistoryExt"><div class="mlsxh-head"><div class="mlsxh-title">Visit history</div></div></div></section>
    <button id="captureBtn">Start recording</button></main>
    <div id="mlsAutoPullChip" style="display:none"></div>
    <section id="historyView" style="display:none"><div id="pullChartStatus" style="display:none"></div></section></body></html>`);

    await page.evaluate(() => {
      window.__activeSyntheticPatient = null;
      window.activePatient = () => window.__activeSyntheticPatient;
      window.getPatients = () => window.__activeSyntheticPatient ? [window.__activeSyntheticPatient] : [];
      window.findPatient = () => window.__activeSyntheticPatient;
      window.upsertPatient = () => true;
      window.savePatients = () => true;
      window.__openPatientPullActivations = 0;
      window.__syntheticTerminalOk = true;
      window.pullPatientFromAthenaPrompt = () => {
        window.__openPatientPullActivations += 1;
        window.dispatchEvent(new CustomEvent('mls:athena-autopull-state', { detail: { busy: true } }));
        setTimeout(() => {
          document.getElementById('mlsAutoPullChip').textContent = window.__syntheticTerminalOk
            ? '✓ Done — the synthetic open chart was read and saved.'
            : '⚠ The synthetic read failed. Nothing was read or saved.';
          window.dispatchEvent(new CustomEvent('mls:athena-autopull-state', { detail: { busy: false } }));
        }, 500);
        return true;
      };
      window.__truthStatus = 'connected';
      window.__mlsConnTruth = { describe: () => ({ status: window.__truthStatus }) };
      window.__mlsAthenaStatusDot = {}; /* production preseed: object, no state */
      window.__mlsEzConn = { ok: true };
      window.__mlsAthenaAutoPull = { isBusy: () => false, run: () => true };
    });
    /* Preserve production listener order: PullOne parks and speaks through the
       one status line, PullVerb owns busy at the control, and feat_visits owns
       the later action-boundary refusal. */
    await page.addScriptTag({ content: pullOneSource });
    await page.addScriptTag({ content: pullVerbSource });
    await page.addScriptTag({ path: path.join(root, 'feat_visits.js') });
    await page.waitForFunction(() => window.__mlsCopyVisits && window.__mlsCopyVisits._openPatientPullHiddenReason);

    /* Run the exact shipped background-panel listener, not a copied helper.
       Its executeScript calls are serialized into this same synthetic MLS page,
       which proves the result the real extension panel receives. */
    let panelMessageListener = null;
    const panelChrome = {
      runtime: { onMessage: { addListener(fn) { panelMessageListener = fn; } } },
      tabs: {
        query: async () => [{ id: 101, windowId: 7, active: false, url: 'https://mlsscribe.com/app' }],
        sendMessage: async () => undefined
      },
      windows: { update: async () => undefined },
      scripting: {
        executeScript: async details => {
          const source = details.func.toString();
          if (source.includes('_openPatientPullHiddenReason')) {
            assert.strictEqual(details.world, 'MAIN',
              'the shipped panel activation ran in Chrome ISOLATED world and could not see the live page gate');
          }
          const args = Array.isArray(details.args) ? details.args : [];
          const result = await page.evaluate(({ source, args }) => {
            const fn = (0, eval)('(' + source + ')');
            return fn.apply(null, args);
          }, { source, args });
          return [{ result }];
        }
      }
    };
    vm.runInNewContext(panelDriverSource, {
      self: {}, chrome: panelChrome, console, Date, Math, Object, Array, String,
      Number, Boolean, RegExp, Promise, setTimeout, clearTimeout
    });
    assert.strictEqual(typeof panelMessageListener, 'function',
      'the exact shipped extension-panel listener did not register');
    async function requestPanelPull() {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('extension-panel pull response timed out')), 3000);
        const returned = panelMessageListener({ type: 'mlsAssistPullToApp', url: 'https://athenanet.athenahealth.com/' }, {}, response => {
          clearTimeout(timeout); resolve(response);
        });
        assert.strictEqual(returned, true, 'the extension-panel route did not keep its async response channel open');
      });
    }

    async function readState() {
      return page.evaluate(() => {
        const button = document.getElementById('ptPullAthenaBtn');
        return {
          hidden: button.hidden || getComputedStyle(button).display === 'none',
          reason: button.getAttribute('data-mls-open-patient-state'),
          ariaHidden: button.getAttribute('aria-hidden'),
          ownerHidden: button.getAttribute('data-mls-open-patient-hidden')
        };
      });
    }

    async function state() {
      await page.evaluate(() => {
        window.__mlsCopyVisits._syncOpenPatientPullVisibility(!!window.__activeSyntheticPatient);
      });
      return readState();
    }

    /* A preview/auth/role owner may have hidden the same static control before
       this module ran. Connected must not force-reveal or adopt that hide. */
    assert.deepStrictEqual(await state(), {
      hidden: true, reason: 'preserved-hidden', ariaHidden: null, ownerHidden: null
    }, 'authoritative connected status force-revealed a control hidden by another owner');
    await page.evaluate(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      b.hidden = false;
      b.style.removeProperty('display');
    });
    assert.deepStrictEqual(await state(), {
      hidden: false, reason: 'visible', ariaHidden: null, ownerHidden: null
    }, 'authoritative connected status did not expose the one eligible read-only action');
    assert(await page.evaluate(() => /Macintosh/.test(navigator.userAgent)),
      'the focused cross-platform runtime did not exercise its Mac Chrome user-agent path');

    /* Exact panel race #1: recording becomes live between the last 900 ms
       visibility repaint and the panel request. The shipped injected route
       must ask the owner NOW, not trust the stale visible data attribute. */
    await page.evaluate(() => { document.body.classList.add('mls-recording'); });
    const recordingRace = await requestPanelPull();
    assert.strictEqual(recordingRace.ok, false,
      'the extension panel reported Sent to MLS during a just-started recording');
    assert.strictEqual(recordingRace.reason, 'recording',
      'the extension panel lost the live recording gate');
    assert.strictEqual(await page.evaluate(() => window.__openPatientPullActivations), 0,
      'the extension panel activated the open-patient pull during recording');
    assert.deepStrictEqual(await page.evaluate(() => {
      const line = document.getElementById('pullChartStatus');
      return {
        visible: getComputedStyle(line).display !== 'none',
        afterButton: line.previousElementSibling && line.previousElementSibling.id === 'ptPullAthenaBtn',
        text: String(line.textContent || '')
      };
    }), {
      visible: true, afterButton: true,
      text: '⚠ Pull not started — finish or pause the current recording before switching the open Athena patient. Nothing was read or saved.'
    }, 'the exact extension-panel recording refusal did not paint the one visible doctor-facing terminal');
    await page.evaluate(() => { document.body.classList.remove('mls-recording'); });

    /* Exact panel race #2: a later preview/auth/role owner hides the same
       control without changing feat_visits' cached state. Every current owner
       hide must refuse activation and must not become a green panel receipt. */
    await page.evaluate(() => { document.getElementById('ptPullAthenaBtn').setAttribute('aria-hidden', 'true'); });
    const laterOwnerRace = await requestPanelPull();
    assert.strictEqual(laterOwnerRace.ok, false,
      'the extension panel reported Sent to MLS for an aria-hidden control');
    assert.strictEqual(laterOwnerRace.reason, 'unavailable',
      'the extension panel misreported a later owner visibility gate');
    assert.strictEqual(await page.evaluate(() => window.__openPatientPullActivations), 0,
      'the extension panel activated a control hidden by a later owner');
    await page.evaluate(() => { document.getElementById('ptPullAthenaBtn').removeAttribute('aria-hidden'); });

    /* Exact production conflict: status dot is preseeded without state and the
       lesser Easy cache is optimistic, while ConnTruth knows there is no tab. */
    await page.evaluate(() => {
      window.__mlsAthenaStatusDot = {};
      window.__mlsEzConn = { ok: true };
      window.__truthStatus = 'no-tab';
    });
    assert.deepStrictEqual(await state(), {
      hidden: true, reason: 'athena-no-tab', ariaHidden: null, ownerHidden: '1'
    }, 'ConnTruth no-tab was overridden by preseed/optimistic lesser signals');

    /* Only an explicitly marked owner-eligible control may be restored. */
    await page.evaluate(() => {
      window.__truthStatus = 'connected';
      document.getElementById('ptPullAthenaBtn').removeAttribute('data-mls-open-patient-owner');
    });
    assert.deepStrictEqual(await state(), {
      hidden: true, reason: 'athena-no-tab', ariaHidden: null, ownerHidden: '1'
    }, 'connected status revealed a control after its visibility ownership was removed');
    await page.evaluate(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      b.setAttribute('data-mls-open-patient-owner', 'feat-visits-v2');
      window.__mlsAthenaStatusDot = { state: 'noathena' };
      window.__mlsEzConn = { ok: false };
    });
    assert.deepStrictEqual(await state(), {
      hidden: false, reason: 'visible', ariaHidden: null, ownerHidden: null
    }, 'authoritative connected did not restore its own hide ahead of stale lesser disconnects');

    /* Prove both directions through the production owner's own 900 ms render
       cadence, without manually invoking the sync hook. */
    await page.evaluate(() => { window.__truthStatus = 'no-tab'; });
    await page.waitForFunction(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      return b.getAttribute('data-mls-open-patient-state') === 'athena-no-tab' &&
        b.getAttribute('data-mls-open-patient-hidden') === '1';
    }, null, { timeout: 4000 });
    assert.strictEqual((await readState()).reason, 'athena-no-tab', 'connected -> no-tab transition did not hide');
    await page.evaluate(() => { window.__truthStatus = 'connected'; });
    await page.waitForFunction(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      return b.getAttribute('data-mls-open-patient-state') === 'visible' &&
        !b.hasAttribute('data-mls-open-patient-hidden');
    }, null, { timeout: 4000 });
    assert.deepStrictEqual(await readState(), {
      hidden: false, reason: 'visible', ariaHidden: null, ownerHidden: null
    }, 'no-tab -> connected transition did not restore the eligible control on the production cadence');

    /* A second owner can hide the control while ConnTruth's no-tab gate is
       active. Removing our gate must leave that later inline hide untouched. */
    await page.evaluate(() => { window.__truthStatus = 'no-tab'; });
    await page.waitForFunction(() => document.getElementById('ptPullAthenaBtn').getAttribute('data-mls-open-patient-hidden') === '1');
    await page.evaluate(() => {
      document.getElementById('ptPullAthenaBtn').style.setProperty('display', 'none', 'important');
      window.__truthStatus = 'connected';
    });
    await page.waitForFunction(() => !document.getElementById('ptPullAthenaBtn').hasAttribute('data-mls-open-patient-hidden'));
    assert.deepStrictEqual(await readState(), {
      hidden: true, reason: 'preserved-hidden', ariaHidden: null, ownerHidden: null
    }, 'no-tab -> connected transition overrode a later inline hide from another owner');
    await page.evaluate(() => { document.getElementById('ptPullAthenaBtn').style.removeProperty('display'); });
    assert.deepStrictEqual(await state(), {
      hidden: false, reason: 'visible', ariaHidden: null, ownerHidden: null
    }, 'removing the other owner did not leave the connected eligible control available');

    await page.evaluate(() => {
      window.__mlsAthenaAutoPull.isBusy = () => true;
    });
    assert.deepStrictEqual(await state(), {
      hidden: true, reason: 'pull-in-flight', ariaHidden: null, ownerHidden: '1'
    }, 'an in-flight Athena pull exposed a competing open-patient action');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('mls:athena-autopull-state', { detail: { busy: true } }));
      document.getElementById('ptPullAthenaBtn').click();
    });
    await page.waitForTimeout(20);
    assert.deepStrictEqual(await page.evaluate(() => ({
      activations: window.__openPatientPullActivations,
      busy: document.getElementById('ptPullAthenaBtn').getAttribute('aria-busy'),
      status: String(document.getElementById('pullChartStatus').textContent || '')
    })), {
      activations: 0, busy: 'true',
      status: '⚠ Pull not started — another Athena pull is already running. Wait for it to finish, then try again. Nothing was read or saved.'
    },
    'the concurrent-click guard either launched a second pull or cleared a genuine auto-pull busy state');
    await page.evaluate(() => {
      window.__mlsAthenaAutoPull.isBusy = () => false;
      window.dispatchEvent(new CustomEvent('mls:athena-autopull-state', { detail: { busy: false } }));
    });

    await page.evaluate(() => {
      document.body.classList.add('mls-recording');
    });
    assert.deepStrictEqual(await state(), {
      hidden: true, reason: 'recording', ariaHidden: null, ownerHidden: '1'
    }, 'live recording exposed a patient-switching action');

    await page.evaluate(() => {
      document.body.classList.remove('mls-recording');
      document.body.setAttribute('data-mls-athena-identity-unsafe', '1');
    });
    assert.deepStrictEqual(await state(), {
      hidden: true, reason: 'identity-unsafe', ariaHidden: null, ownerHidden: '1'
    }, 'an explicit unsafe identity state exposed the open-patient action');

    await page.evaluate(() => {
      document.body.removeAttribute('data-mls-athena-identity-unsafe');
      window.__activeSyntheticPatient = {
        id: 'selected-1', name: 'Synthetic Selected', dob: '01/01/1970', visits: []
      };
      /* Repeat the actual owner renders: neither the static toolbar action nor
         the selected-patient history action may multiply. */
      for (let i = 0; i < 6; i += 1) {
        window.__mlsCopyVisits._ensureBar();
        window.__mlsCopyVisits._syncOpenPatientPullVisibility(true);
      }
    });

    /* Start the real selected-patient history engine and hold its correlated
       bridge request. The open-Athena action must disappear on the production
       owner cadence for the entire run, then return only after that same
       closure's authoritative running flag settles. */
    const immediateRunGate = await page.evaluate(() => {
      window._athenaHistoryTargetSnapshot = ref => ({
        patientId: String(ref.patientId || ''), name: String(ref.name || ''),
        dob: String(ref.dob || ''), mrn: String(ref.mrn || '')
      });
      window._assistReadChart = ref => Promise.resolve({ targetPatientId: String(ref.patientId || '') });
      window.__heldHistoryRequestId = '';
      window.__heldHistoryBridge = event => {
        const data = event && event.data;
        if (!data || data.source !== 'mls-app') return;
        if (data.type === 'mlsPing') {
          setTimeout(() => window.postMessage({ source: 'mls-ext', type: 'mlsPong' }, '*'), 0);
        }
        if (data.type === 'mlsAppReadAllVisits') {
          window.__heldHistoryRequestId = String(data.requestId || data.id || '');
        }
      };
      window.addEventListener('message', window.__heldHistoryBridge);
      window.__heldHistoryRun = window.__mlsCopyVisits.run(() => {}, window.__activeSyntheticPatient)
        .then(() => ({ settled: true, rejected: false }), error => ({
          settled: true, rejected: true, message: String(error && error.message || '')
        }));
      const b = document.getElementById('ptPullAthenaBtn');
      return {
        running: window.__mlsCopyVisits.isRunning(),
        state: b.getAttribute('data-mls-open-patient-state'),
        ownerHidden: b.getAttribute('data-mls-open-patient-hidden'),
        hidden: b.hidden || getComputedStyle(b).display === 'none'
      };
    });
    assert.deepStrictEqual(immediateRunGate, {
      running: true, state: 'pull-in-flight', ownerHidden: '1', hidden: true
    }, 'the selected-history transition did not synchronously close the competing open-patient gate');
    assert.strictEqual(await page.evaluate(() => {
      document.getElementById('ptPullAthenaBtn').click();
      return window.__openPatientPullActivations;
    }), 0, 'programmatic activation crossed the synchronous pull-in-flight action gate');
    const panelBlocked = await requestPanelPull();
    assert.strictEqual(panelBlocked.ok, false,
      'the shipped extension panel reported a gated click as Sent to MLS');
    assert.strictEqual(panelBlocked.reason, 'pull-in-flight',
      'the shipped extension panel lost the authoritative pull-in-flight reason');
    assert.match(String(panelBlocked.error || ''), /already running/i,
      'the shipped extension panel did not explain why the pull was refused');
    assert.strictEqual(await page.evaluate(() => window.__openPatientPullActivations), 0,
      'the shipped extension-panel route crossed the held selected-history gate');
    await page.waitForTimeout(20);
    assert.deepStrictEqual(await page.evaluate(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      return { busy: b.getAttribute('aria-busy'), label: String(b.textContent).replace(/\s+/g, ' ').trim() };
    }), { busy: null, label: '📥 Pull the open patient in athena' },
    'the earlier shipped PullVerb listener painted a false busy state after the blocked activation');
    await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => {
      document.getElementById('ptPullAthenaBtn').click();
      return window.__openPatientPullActivations;
    }), 0, 'programmatic activation crossed the action gate 50ms into the held pull');
    await page.waitForFunction(() => !!window.__heldHistoryRequestId, null, { timeout: 5000 });
    await page.waitForFunction(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      return window.__mlsCopyVisits.isRunning() === true &&
        b.getAttribute('data-mls-open-patient-state') === 'pull-in-flight' &&
        b.getAttribute('data-mls-open-patient-hidden') === '1';
    }, null, { timeout: 4000 });
    assert.deepStrictEqual(await readState(), {
      hidden: true, reason: 'pull-in-flight', ariaHidden: null, ownerHidden: '1'
    }, 'the real selected-history run left the competing open-patient action visible');
    const settledRun = await page.evaluate(async () => {
      const requestId = window.__heldHistoryRequestId;
      window.postMessage({
        source: 'mls-ext', type: 'mlsAppAllVisitsResult', requestId,
        ok: false, error: 'held bridge released for visibility regression'
      }, '*');
      const result = await window.__heldHistoryRun;
      window.removeEventListener('message', window.__heldHistoryBridge);
      return result;
    });
    assert.strictEqual(settledRun.settled, true, 'the held selected-history run did not settle');
    assert.strictEqual(settledRun.rejected, true, 'the held bridge did not exercise the run rejection/finally path');
    await page.waitForFunction(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      return window.__mlsCopyVisits.isRunning() === false &&
        b.getAttribute('data-mls-open-patient-state') === 'visible-with-selected-patient' &&
        !b.hasAttribute('data-mls-open-patient-hidden');
    }, null, { timeout: 4000 });
    assert.deepStrictEqual(await readState(), {
      hidden: false, reason: 'visible-with-selected-patient', ariaHidden: null, ownerHidden: null
    }, 'the open-patient action did not return after the selected-history run settled');
    assert.strictEqual(await page.evaluate(() => document.getElementById('ptPullAthenaBtn').getAttribute('aria-busy')), null,
      'the restored control retained a false PullVerb busy state after the selected-history run settled');
    const panelAllowed = await requestPanelPull();
    assert.strictEqual(panelAllowed && panelAllowed.ok, true,
      'the shipped extension-panel route did not work after the authoritative gate reopened');
    assert.strictEqual(panelAllowed && panelAllowed.via, 'clicked',
      'the shipped extension-panel route did not report its one exact activation');
    assert.strictEqual(await page.evaluate(() => window.__openPatientPullActivations), 1,
      'the successful shipped extension-panel route did not activate the restored control exactly once');
    const admittedStart = await page.evaluate(() => String(document.getElementById('pullChartStatus').textContent || ''));
    assert.match(admittedStart, /^Starting the read-only Athena pull/,
      'an admitted restored-control click did not paint an immediate visible started state');
    await page.waitForFunction(() => /^✓ Done/.test(String(document.getElementById('pullChartStatus').textContent || '')));
    assert.deepStrictEqual(await page.evaluate(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      const line = document.getElementById('pullChartStatus');
      return {
        busy: b.getAttribute('aria-busy'),
        label: String(b.textContent).replace(/\s+/g, ' ').trim(),
        visible: getComputedStyle(line).display !== 'none',
        afterButton: line.previousElementSibling === b,
        text: String(line.textContent || '')
      };
    }), {
      busy: null, label: '📥 Pull the open patient in athena', visible: true, afterButton: true,
      text: '✓ Done — the synthetic open chart was read and saved.'
    }, 'the admitted success did not finish visibly or left the restored control busy');

    const admittedFailureStart = await page.evaluate(() => {
      window.__syntheticTerminalOk = false;
      document.getElementById('ptPullAthenaBtn').click();
      return String(document.getElementById('pullChartStatus').textContent || '');
    });
    assert.match(admittedFailureStart, /^Starting the read-only Athena pull/,
      'the admitted failure path did not first paint its visible started state');
    await page.waitForFunction(() => /^⚠ The synthetic read failed/.test(String(document.getElementById('pullChartStatus').textContent || '')));
    assert.deepStrictEqual(await page.evaluate(() => {
      const b = document.getElementById('ptPullAthenaBtn');
      return {
        activations: window.__openPatientPullActivations,
        busy: b.getAttribute('aria-busy'),
        text: String(document.getElementById('pullChartStatus').textContent || '')
      };
    }), {
      activations: 2, busy: null,
      text: '⚠ The synthetic read failed. Nothing was read or saved.'
    }, 'the admitted failure did not finish truthfully or left the restored control busy');

    const distinct = await page.evaluate(() => {
      window.__mlsCopyVisits._syncOpenPatientPullVisibility(true);
      return {
        openActions: document.querySelectorAll('[data-mls-pullverb="open-in-athena"]').length,
        openIdActions: document.querySelectorAll('#ptPullAthenaBtn').length,
        selectedActions: document.querySelectorAll('#mlsCopyVisitsBar .mls-cv-btn').length,
        openVisible: getComputedStyle(document.getElementById('ptPullAthenaBtn')).display !== 'none',
        openParent: document.getElementById('ptPullAthenaBtn').parentElement.id,
        selectedLabel: document.querySelector('#mlsCopyVisitsBar .mls-cv-btn').textContent
      };
    });
    assert.deepStrictEqual(distinct, {
      openActions: 1, openIdActions: 1, selectedActions: 1, openVisible: true,
      openParent: 'patientTools',
      selectedLabel: 'Refresh full visit history'
    }, 'repeated Patients renders duplicated, relocated, or hid one of the two distinct pull verbs');

    for (const width of [320, 360, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const fit = await page.evaluate(() => {
        window.__mlsCopyVisits._syncOpenPatientPullVisibility(true);
        const r = document.getElementById('ptPullAthenaBtn').getBoundingClientRect();
        return { left: r.left, right: r.right, viewport: document.documentElement.clientWidth, width: r.width };
      });
      assert(fit.width > 0, `${width}px: the available control collapsed`);
      assert(fit.left >= 0 && fit.right <= fit.viewport + 0.5,
        `${width}px: the available control overflowed (${JSON.stringify(fit)})`);
    }

    const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
    assert(connect.includes("s.src='feat_visits.js"),
      'the fixed visibility owner is not loaded by the shipped 1p connection bundle');
    assert(!connect.includes('feat_mls_staff_hub.js'),
      'staff-hub unexpectedly became reachable; this regression must be re-audited before relying on its role path');

    console.log('PASS open Athena patient control: explicit ownership, authoritative ConnTruth transitions, pre-hidden preservation, all pull/recording/identity safety including held selected-history run, selected-profile distinction, Mac UA + 320px fit, duplicate-free rerenders');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
