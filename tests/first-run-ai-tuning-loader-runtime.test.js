'use strict';

/* Configure must wait for the real lazy Settings owner, and a real Settings
 * save must repaint the checklist from namespaced store truth. No network,
 * account, patient, or Athena state is involved. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const firstRunSource = fs.readFileSync(path.join(root, 'feat_mls_firstrun.js'), 'utf8');

function extractFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' is present');
  const start = src.slice(Math.max(0, at - 6), at) === 'async ' ? at - 6 : at;
  const open = src.indexOf('{', at); let depth = 0; let quote = ''; let line = false; let block = false;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i], n = src[i + 1] || '';
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i += 1; } continue; }
    if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = ''; continue; }
    if (c === '/' && n === '/') { line = true; i += 1; continue; }
    if (c === '/' && n === '*') { block = true; i += 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

const handlers = [
  extractFunction(firstRunSource, 'focusAiFormats'),
  extractFunction(firstRunSource, 'showAiConfigureFailure'),
  extractFunction(firstRunSource, 'onAiClick')
].join('\n');

function configureHarness(loader, withSection = true) {
  const timers = [];
  const hint = { textContent: '' };
  const row = { className: '', querySelector() { return hint; } };
  const button = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const modal = { classList: { contains(name) { return name === 'show'; } } };
  const section = withSection ? { classList: { remove() {} }, style: {}, scrollIntoView() {} } : null;
  const first = { focus() { this.focused = true; } };
  const nodes = { mlsFrRow_tuning: row, mlsFrAiBtn: button, settingsModal: modal, mlsDraftTuningSection: section, mlsDtFamily: first };
  const document = { getElementById(id) { return nodes[id] || null; }, querySelector() { return null; } };
  const window = { __mlsEnsureDraftTuning: loader, openSettings() { this.opened = true; }, opened: false };
  const context = vm.createContext({ window, document, Promise, timers, console });
  vm.runInContext(`
    function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
    function byId(id) { return document.getElementById(id); }
    function qs(sel) { return document.querySelector(sel); }
    function isFn(f) { return typeof f === 'function'; }
    function later(fn) { timers.push(fn); return timers.length; }
    function setClass(el, value) { if (el) el.className = value; }
    function setText(el, value) { if (el) el.textContent = value; }
  ` + handlers, context, { filename: 'feat_mls_firstrun.js#configure-runtime' });
  return { context, window, hint, button, first };
}

(async function run() {
  async function settle() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }
  let release;
  const delayed = configureHarness(() => new Promise(resolve => { release = resolve; }));
  delayed.context.onAiClick();
  await Promise.resolve();
  assert.strictEqual(delayed.window.opened, false, 'Configure opened Settings before its owner loaded');
  release({ installed: true });
  await settle();
  assert.strictEqual(delayed.window.opened, true, 'Configure did not open Settings after loader success');
  assert.strictEqual(delayed.first.focused, true, 'Configure did not focus the exact AI format editor');

  for (const bad of [() => Promise.reject(new Error('load failed')), () => Promise.resolve(null)]) {
    const failed = configureHarness(bad);
    failed.context.onAiClick();
    await settle();
    assert.strictEqual(failed.window.opened, false, 'failed loader opened Settings');
    assert.match(failed.hint.textContent, /could not be opened|reload MLS/i, 'loader failure was silent');
    assert.strictEqual(failed.button.disabled, false, 'failed Configure button stayed disabled');
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const shell = `<!doctype html><html><body>
      <main id="appScreen"><section id="visitView"><div id="visitHero"></div></section></main>
      <div id="settingsModal" class="show"><div class="modal"><button onclick="saveSettings()">Save settings</button></div></div>
    </body></html>`;
    await page.route('https://mls-first-run-settings.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: shell }));
    await page.goto('https://mls-first-run-settings.test/settings');
    await page.evaluate(() => {
      window.uns = key => 'first-run-save::' + key;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard';
      window.getGenInstr = () => '';
    });
    await page.addScriptTag({ path: path.join(root, 'feat_mls_firstrun.js') });
    await page.evaluate(() => window.__mlsFirstRun.ensure());
    assert.strictEqual(await page.locator('#mlsFrRow_tuning.ok').count(), 0,
      'unsaved defaults falsely completed Configure');
    await page.addScriptTag({ path: path.join(root, 'feat_mls_draft_tuning.js') });
    await page.evaluate(() => window.__mlsDraftTuning.saveFromUi());
    await page.waitForTimeout(50);
    const savedPaint = await page.evaluate(() => ({
      truth: window.__mlsFirstRun._truth.tuning(),
      row: document.getElementById('mlsFrRow_tuning') && document.getElementById('mlsFrRow_tuning').className,
      keys: Object.keys(localStorage),
      stored: localStorage.getItem(window.uns('draftTuningV1'))
    }));
    assert.strictEqual(savedPaint.truth, 'ok', 'saved account state did not satisfy first-run truth: ' + JSON.stringify(savedPaint));
    assert.match(savedPaint.row || '', /\bok\b/, 'saved truth did not repaint Configure: ' + JSON.stringify(savedPaint));
    assert.strictEqual(await page.locator('#mlsFrRow_tuning.ok').count(), 1,
      'saved account formats did not repaint Configure as complete');
  } finally {
    await browser.close();
  }

  console.log('PASS first-run AI tuning runtime: Configure awaits/focuses canonical Settings, failures are visible, and saved account truth repaints completion');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
