'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const policy = read('public-preview-policy.js');
const runtime = read('public-preview-runtime.js');
const config = read('_config.yml');
const sw = read('sw.js');
const bundle = read('mls-connect.js');
const studyGroups = read('feat_mls_studygroups.js');
const inventory = JSON.parse(read('pages-publication-inventory.json')).paths;

const policyTag = '<script src="public-preview-policy.js?v=b476"></script>';
const runtimeTag = '<script src="public-preview-runtime.js?v=b476"></script>';
const policyAt = app.indexOf(policyTag);
const purgeAt = app.indexOf('<script src="clinical-state-purge.js');
const appMainAt = app.indexOf('const _SF_DEMO = (function(){');
const appMainCloseAt = app.indexOf('</script>', app.indexOf('function _ptGroupSort'));
const runtimeAt = app.indexOf(runtimeTag);
const bundleLoaderAt = app.indexOf('window.__mlsEnsureUiBundle=function()');

assert(policyAt > 0 && policyAt < purgeAt && policyAt < appMainAt,
  'preview policy must install before clinical storage, auth, backend, and feature code');
assert(runtimeAt > appMainCloseAt && runtimeAt < bundleLoaderAt,
  'preview runtime must seed after main globals exist and before the UI bundle can boot');
assert(app.includes("window.__MLS_PUBLIC_PREVIEW&&window.__MLS_PUBLIC_PREVIEW.enabled===true"),
  'preview does not force the existing backend selector into no-backend mode');
assert(app.includes("p&&p.enabled===true&&p.mode==='synthetic-read-only'&&p.storageMode==='memory'&&p.memoryStorageReady===true"),
  'missing/failed preview policy is not checked before later scripts run');
assert(/document\.write\('[\s\S]*Sample workspace unavailable[\s\S]*did not open an account, contact Athena/.test(app),
  'failed preview policy does not replace the app with a static fail-closed explanation');
assert(/var p=window\.__MLS_PUBLIC_PREVIEW;if\(p&&p\.enabled===true\)return;[\s\S]*serviceWorker\.register/.test(app),
  'preview does not skip service-worker registration and backend preconnect');

assert(policy.includes("String(location.search || '') === '?preview=1'"),
  'preview route is not an exact one-parameter route');
assert(policy.includes("String(location.pathname || '') === '/ScribeFlow.html'"),
  'preview route is not bound to the reviewed clinician page');
assert(policy.includes("hostname === 'mlsscribe.com'") && policy.includes('isLoopback(hostname)'),
  'preview can activate on an unreviewed host');
assert(policy.includes("connect-src 'none'") && policy.includes("form-action 'none'") && policy.includes("media-src 'none'"),
  'preview does not add the restrictive browser CSP boundary');
assert(policy.includes("if (cspInstalled) pass('dynamic-csp')") && policy.includes("else fail('dynamic-csp')"),
  'preview can become ready after its restrictive CSP fails to install');
assert(policy.includes("immutable(root, '__MLS_SYNTHETIC_ONLY', true)"),
  'synthetic-only marker is not immutable');
assert(runtime.includes("mode !== 'synthetic-read-only'") && runtime.includes("storageMode !== 'memory'"),
  'runtime can start without the complete policy contract');
assert(runtime.includes("typeof backendMode !== 'function' || backendMode() !== false"),
  'runtime can seed while the hosted backend is still active');
assert(runtime.includes("data-mls-synthetic-boundary") && runtime.includes('SAMPLE WORKSPACE'),
  'canonical workspace lacks its persistent synthetic boundary');
assert(runtime.includes("data-mls-action') === 'staff-prep'") && runtime.includes('mls-preview-menu-badge'),
  'Menu-only Staff Prep is not preserved and labeled in preview');
assert(runtime.includes("querySelector('#mlsTbMenuPanel #nav_orders')") && runtime.includes('Orders are unavailable in the read-only sample workspace.'),
  'legacy Orders menu proxy remains visible in preview');
assert(runtime.includes('orders.parentNode.removeChild(orders)') && runtime.includes("document.getElementById('nav_studio')") &&
  runtime.includes("document.getElementById('nav_analysis')"),
  'preview retains live Orders, AI Studio, or Analysis navigation');
assert(runtime.includes("document.getElementById('mlsPqsBox')") && runtime.includes("document.getElementById('mlsPqsInput')"),
  'preview retains a dead global finder or online-assistant escape');
assert(runtime.includes("document.getElementById('mlsQuickFindOv')") && runtime.includes("key === '/'") && runtime.includes("key === 'k'"),
  'preview global-search shortcuts can still open live div-row commands');
assert(runtime.includes("hidePreviewNode(document.getElementById('mlsPullFlowPanel'))") &&
  runtime.includes('Invented patients and notes stay in temporary memory'),
  'preview retains misleading live-connectivity or persistent-storage UI');
assert(runtime.includes("var appt = document.getElementById('mlsCtxApptChip')") &&
  runtime.includes('hidePreviewNode(dayProgress); hidePreviewNode(agenda); hidePreviewNode(appt);') && runtime.includes('selectedPreviewDay()'),
  'future sample dates can retain Today-specific patient progress chrome');
assert(runtime.includes("button.textContent = 'Reload sample day'") && runtime.includes("start.setAttribute('data-mls-preview-action', 'sample-month')"),
  'day and month sample reloads do not stay inside the canonical controls');
assert(runtime.includes('isSafePreviewNavigation') && runtime.includes('ez3Choose|ez3Hist|ez3Prep|ez3Adv'),
  'read-only preview can block its own patient/history/workspace navigation');
assert(runtime.includes("['ez3Chart2', 'ez3Prep2', 'ez3Portal', 'mlsPortalInviteBtn']") &&
  runtime.includes('No invented appointments are included for this sample date.'),
  'Easy room or empty-day rerenders can expose live actions or Athena instructions');
assert((bundle.match(/skipped: 'public-synthetic-preview'/g) || []).length >= 2,
  'legacy import-chain copies do not skip their primitive patching in preview');
assert(studyGroups.includes('__MLS_PUBLIC_PREVIEW') && studyGroups.includes("skipped: 'public-synthetic-preview'") &&
  bundle.includes('feat_mls_studygroups.js') && bundle.includes('20260719sg1c5'),
  'preview still boots the hidden Study Groups/AI Studio module');
assert(bundle.includes("try { if (!oFetch.__r44) window.fetch = wrappedFetch; } catch (e) {}") &&
  bundle.includes("try { if (window.fetch === wrappedFetch) window.fetch = oFetch; } catch (e) {}"),
  'legacy bundle can still crash when the preview policy makes fetch immutable');
assert(bundle.includes('function startPoll()') &&
  bundle.includes('if (window.__MLS_PUBLIC_PREVIEW && window.__MLS_PUBLIC_PREVIEW.enabled === true) return;') &&
  bundle.includes('if (!(window.__MLS_PUBLIC_PREVIEW && window.__MLS_PUBLIC_PREVIEW.enabled === true)) {'),
  'preview still installs legacy clock/status or record-lane repaint intervals');
assert(/function syncTopLane\(rec\) \{[\s\S]{0,400}__MLS_PUBLIC_PREVIEW[\s\S]{0,900}Recording off in preview/.test(bundle),
  'the primary record-lane owner can repaint live recording copy over the preview boundary');
for (const asset of [
  'feat_task3_frontsync.js', 'feat_copilot_slim.js', 'feat_b18_qa.js',
  'feat_mls_provider_passthrough.js', 'feat_mls_b121_pack.js'
]) {
  assert(read(asset).includes('__MLS_PUBLIC_PREVIEW'), `${asset} lacks a preview guard around protected browser primitives`);
}
const loadingCalm = read('feat_mls_loading_calm.js');
assert(loadingCalm.includes("visualOwner: 'mlsProgressStages'") &&
  !loadingCalm.includes('window.fetch = wrapped') && !loadingCalm.includes("window.addEventListener('message'"),
  'headless loading store regained a browser-primitive wrapper or duplicate visual owner');

{
  const previewWindow = {
    document: {},
    __MLS_PUBLIC_PREVIEW: Object.freeze({ enabled: true, mode: 'synthetic-read-only' })
  };
  Object.defineProperty(previewWindow, 'fetch', {
    configurable: false,
    enumerable: true,
    writable: false,
    value() { throw new Error('preview must not call live fetch'); }
  });
  previewWindow.window = previewWindow;
  assert.doesNotThrow(() => vm.runInNewContext(read('feat_mls_status_center.js'), previewWindow),
    'delayed Status Center boot mutated the preview policy\'s immutable fetch boundary');
  assert.strictEqual(previewWindow.__mlsStatusCenter, undefined,
    'Status Center installed live connectivity state inside the sealed preview');
}

{
  let providerIntervals = 0;
  const providerPreview = {
    __MLS_PUBLIC_PREVIEW: Object.freeze({ enabled: true, mode: 'synthetic-read-only' }),
    setInterval() { providerIntervals += 1; return providerIntervals; }
  };
  providerPreview.window = providerPreview;
  vm.runInNewContext(read('feat_mls_provider_passthrough.js'), providerPreview);
  assert.strictEqual(providerIntervals, 0, 'provider passthrough installed a recurring chip painter in preview');
  assert(providerPreview.__mlsProv && providerPreview.__mlsProv.skipped === 'public-synthetic-preview',
    'provider passthrough did not exit before its Athena picker/chip side effects');
}

for (const asset of ['public-preview-policy.js', 'public-preview-runtime.js']) {
  assert(config.includes(`- "${asset}"`), `${asset} is not explicitly reviewed in the Pages allowlist`);
  assert(inventory.includes(asset), `${asset} is missing from the exact Pages inventory`);
  assert(sw.includes(`/${asset}?v=b476`), `${asset} is missing from the immutable app shell`);
}

assert(app.includes('const BACKEND_URL = _SF_DEMO ? "" : "https://scrivara-backend.onrender.com"'),
  'ordinary hosted mode no longer points at the production backend');
assert(app.includes('const _gateMode = backendMode()') && app.includes('checkAgreementsGate(_startupOpts)'),
  'ordinary hosted mode no longer retains the legal/readiness gate');

console.log('PASS public preview integration: earliest fail-closed policy, memory-only canonical runtime, reviewed publication assets, hosted gate unchanged');
