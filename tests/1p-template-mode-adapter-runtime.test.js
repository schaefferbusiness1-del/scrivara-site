'use strict';

/* Browser proof for the /p1-only presentation adapter. The real operative-note
 * engine remains the owner of values, clicks, storage, generation and cloud
 * template functions; this test checks that only their visible labels move. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const assetName = '1p-feat_mls_template_modes.js';
const version = 'p1-template-modes-1.0.0';
const asset = fs.readFileSync(path.join(root, assetName), 'utf8');
const regularFiles = [
  'ScribeFlow.html',
  'mls-connect.js',
  'feat_mls_opnote_room.js',
  'feat_mls_opnote_integrity.js',
  'feat_mls_opnote_templates_ui.js',
  'feat_mls_template_library.js'
];
function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
}
const regularBefore = Object.fromEntries(regularFiles.map(file => [file, digest(file)]));

assert(!/localStorage|sessionStorage|document\.cookie|fetch\s*\(|XMLHttpRequest|WebSocket/.test(asset),
  'label adapter gained storage, identity or network authority');
assert(!/setTemplates\s*=|openTemplates\s*=|saveTemplateFromForm\s*=|editTemplate\s*=|__mlsTemplateLibrary\s*=/.test(asset),
  'label adapter wraps or replaces established template-library owners');
assert(!fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8').includes(assetName),
  'regular-site connector loads the P1-only adapter');
assert(!fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8').includes('__mlsP1TemplateModes'),
  'regular-site shell contains P1 template-mode code');

let checks = 4;
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function ok(value, message) { assert.ok(value, message); checks++; }

function controls() {
  return `<div id="oprDayRail"><div id="oprTplMode">
    <button id="strict" data-tplmode="strict" title="Follow it closely — Keeps your wording. Fills only what varies."><span class="nm">Follow it closely<span class="opr-nav-st">Keeps your wording. Fills only what varies.</span></span></button>
    <button id="adapt" data-tplmode="adapt" title="Adapt to the case — Keeps your structure, adapts the wording. Recommended."><span class="nm">Adapt to the case<span class="opr-nav-st">Keeps your structure, adapts the wording. Recommended.</span></span></button>
    <button id="guide" data-tplmode="guide" title="Use it as a guide — concise — Keeps your headings, writes tighter prose in its own words."><span class="nm">Use it as a guide — concise<span class="opr-nav-st">Keeps your headings, writes tighter prose in its own words.</span></span></button>
    <button id="foreign-mode" data-tplmode="future">Future mode</button>
  </div></div>
  <div id="oprReceipt"><div class="opr-usedstyle"><span>Style used</span><b>Adapt to the case</b>
    <button id="redo-strict" data-oprredo="strict">Re-draft: Follow it closely</button>
    <button id="redo-guide" data-oprredo="guide">Re-draft: Use it as a guide — concise</button>
  </div></div>`;
}

function pageHtml(options) {
  options = options || {};
  const preview = options.preview === false ? 'false' : 'true';
  const loaderToken = options.loaderToken || 'p1-template-mode-test-token';
  const scriptToken = options.scriptToken || 'p1-template-mode-test-token';
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${controls()}
  <script>
    window.__MLS_P1_PREVIEW={enabled:${preview},route:'/1p/'};
    window.__mlsP1TemplateModesLoader={installed:true,version:'${version}',installToken:'${loaderToken}'};
    window.__templateCalls=0;
    window.getTemplates=function(){return [{id:'t1'}]};
    window.setTemplates=function(v){window.__templateCalls++;return v};
    window.openTemplates=function(){window.__templateCalls++;return 'open'};
    window.saveTemplateFromForm=function(){window.__templateCalls++;return 'save'};
    window.editTemplate=function(){window.__templateCalls++;return 'edit'};
    window.__mlsTemplateLibrary={installed:true,version:'tl-1.6.0',state:{activeVersion:7},refresh:function(){},previewImport:function(){},commitPending:function(){},activateSet:function(){},applySet:function(){},persistSnapshot:function(){},render:function(){}};
    window.__templateRefs={getTemplates:getTemplates,setTemplates:setTemplates,openTemplates:openTemplates,saveTemplateFromForm:saveTemplateFromForm,editTemplate:editTemplate,library:__mlsTemplateLibrary};
    localStorage.setItem('sf_u::alpha@example.test::opNoteTemplateMode','guide');
    window.__keysBefore=Object.keys(localStorage).sort().join('|');
    document.getElementById('strict').addEventListener('click',function(){window.__clicked=(window.__clicked||0)+1});
  </script>
  <script src="/adapter.js" data-mls-asset="${assetName}" data-mls-version="${version}" data-mls-install-token="${scriptToken}"></script>
  </body></html>`;
}

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/adapter.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(asset);
      }
      res.setHeader('Content-Type', 'text/html');
      if (url.pathname === '/no-preview') return res.end(pageHtml({ preview: false }));
      if (url.pathname === '/bad-token') return res.end(pageHtml({ loaderToken: 'loader-owner', scriptToken: 'foreign-script' }));
      return res.end(pageHtml());
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function modeLabels(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#oprTplMode [data-tplmode]')).map(button => ({
    mode: button.getAttribute('data-tplmode'),
    label: Array.from((button.querySelector('.nm') || button).childNodes).find(node => node.nodeType === 3).nodeValue.trim(),
    detail: button.querySelector('.opr-nav-st') && button.querySelector('.opr-nav-st').textContent,
    title: button.getAttribute('title')
  })));
}

(async function run() {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failure = null;
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error && error.message || error)));
    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mlsP1TemplateModes &&
      document.querySelector('#adapt .nm').firstChild.nodeValue.trim() === 'Balanced');

    const labels = await modeLabels(page);
    eq(labels[0].mode, 'strict', 'strict internal value changed');
    eq(labels[0].label, 'Closely', 'strict label is not exact');
    eq(labels[1].mode, 'adapt', 'adapt internal value changed');
    eq(labels[1].label, 'Balanced', 'adapt label is not exact');
    eq(labels[2].mode, 'guide', 'guide internal value changed');
    eq(labels[2].label, 'Adapt to case', 'guide label is not exact');
    eq(labels[3].label, 'Future mode', 'unknown future mode was guessed instead of failing closed');
    eq(labels[0].detail, 'Keeps your wording. Fills only what varies.', 'strict behavior help changed');
    eq(labels[1].detail, 'Keeps your structure, adapts the wording. Recommended.', 'balanced behavior help changed');
    eq(labels[2].detail, 'Keeps your headings, writes tighter prose in its own words.', 'guide behavior help changed');
    eq(labels[0].title, 'Closely — Keeps your wording. Fills only what varies.', 'hover label stayed stale');

    const receipt = await page.evaluate(() => ({
      used: document.querySelector('#oprReceipt .opr-usedstyle > b').textContent.trim(),
      strict: document.getElementById('redo-strict').textContent.trim(),
      guide: document.getElementById('redo-guide').textContent.trim()
    }));
    eq(receipt.used, 'Balanced', 'used-style receipt was not mapped from adapt');
    eq(receipt.strict, 'Re-draft: Closely', 'strict re-draft label is stale');
    eq(receipt.guide, 'Re-draft: Adapt to case', 'guide re-draft label is stale');

    const preserved = await page.evaluate(() => {
      const refs = window.__templateRefs;
      document.getElementById('strict').click();
      return {
        clicked: window.__clicked,
        mode: document.getElementById('strict').getAttribute('data-tplmode'),
        refs: refs.getTemplates === getTemplates && refs.setTemplates === setTemplates &&
          refs.openTemplates === openTemplates && refs.saveTemplateFromForm === saveTemplateFromForm &&
          refs.editTemplate === editTemplate && refs.library === __mlsTemplateLibrary,
        cloudVersion: __mlsTemplateLibrary.version,
        activeVersion: __mlsTemplateLibrary.state.activeVersion,
        stored: localStorage.getItem('sf_u::alpha@example.test::opNoteTemplateMode'),
        keys: Object.keys(localStorage).sort().join('|'),
        before: window.__keysBefore
      };
    });
    eq(preserved.clicked, 1, 'adapter broke the established control click');
    eq(preserved.mode, 'strict', 'adapter rewrote the established internal value');
    eq(preserved.refs, true, 'template library/edit/search/save owners changed identity');
    eq(preserved.cloudVersion, 'tl-1.6.0', 'cloud library version changed');
    eq(preserved.activeVersion, 7, 'cloud active version changed');
    eq(preserved.stored, 'guide', 'existing account-scoped mode persistence changed');
    eq(preserved.keys, preserved.before, 'adapter persisted an identity, preference or receipt');

    /* Shared room rebuilds with innerHTML. MutationObserver must relabel it
       without requiring a second template library or a wrapper around render. */
    await page.evaluate(markup => {
      document.getElementById('oprTplMode').innerHTML = markup;
      document.getElementById('oprReceipt').innerHTML = '<div class="opr-usedstyle"><span>Style used</span><b>Use it as a guide — concise</b><button data-oprredo="adapt">Re-draft: Adapt to the case</button></div>';
    }, `<button data-tplmode="strict"><span class="nm">Follow it closely<span class="opr-nav-st">Keeps your wording. Fills only what varies.</span></span></button><button data-tplmode="adapt"><span class="nm">Adapt to the case<span class="opr-nav-st">Keeps your structure, adapts the wording. Recommended.</span></span></button><button data-tplmode="guide"><span class="nm">Use it as a guide — concise<span class="opr-nav-st">Keeps your headings, writes tighter prose in its own words.</span></span></button>`);
    await page.waitForFunction(() => document.querySelector('#oprTplMode [data-tplmode="guide"] .nm').firstChild.nodeValue.trim() === 'Adapt to case');
    const dynamic = await page.evaluate(() => ({
      labels: Array.from(document.querySelectorAll('#oprTplMode .nm')).map(n => n.firstChild.nodeValue.trim()),
      used: document.querySelector('#oprReceipt b').textContent.trim(),
      redo: document.querySelector('#oprReceipt [data-oprredo]').textContent.trim()
    }));
    assert.deepStrictEqual(dynamic.labels, ['Closely', 'Balanced', 'Adapt to case']); checks++;
    eq(dynamic.used, 'Adapt to case', 'dynamic used-style guide label is stale');
    eq(dynamic.redo, 'Re-draft: Balanced', 'dynamic adapt re-draft label is stale');

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: {
      prior: 'alpha@example.test', next: 'beta@example.test', rawPatientName: 'Never persist me'
    } })));
    await page.waitForTimeout(20);
    const afterBoundary = await page.evaluate(() => ({
      label: document.querySelector('#oprTplMode [data-tplmode="adapt"] .nm').firstChild.nodeValue.trim(),
      stored: localStorage.getItem('sf_u::alpha@example.test::opNoteTemplateMode'),
      keys: Object.keys(localStorage).sort().join('|'), before: window.__keysBefore,
      sourceLeak: Object.values(localStorage).join('|').includes('Never persist me')
    }));
    eq(afterBoundary.label, 'Balanced', 'session transition lost the P1 label mapping');
    eq(afterBoundary.stored, 'guide', 'session transition changed established account persistence');
    eq(afterBoundary.keys, afterBoundary.before, 'session transition created cross-account adapter state');
    eq(afterBoundary.sourceLeak, false, 'raw session identity reached persistence');

    /* Loading the exact same owned asset twice is idempotent. */
    const duplicate = await page.evaluate(() => new Promise(resolve => {
      window.__firstTemplateModeApi = window.__mlsP1TemplateModes;
      const node = document.createElement('script');
      node.src = '/adapter.js?duplicate=1';
      node.setAttribute('data-mls-asset', '1p-feat_mls_template_modes.js');
      node.setAttribute('data-mls-version', 'p1-template-modes-1.0.0');
      node.setAttribute('data-mls-install-token', 'p1-template-mode-test-token');
      node.onload = () => resolve(window.__firstTemplateModeApi === window.__mlsP1TemplateModes);
      document.head.appendChild(node);
    }));
    eq(duplicate, true, 'same-owner duplicate load installed a second adapter');

    const reverted = await page.evaluate(() => {
      const old = window.__mlsP1TemplateModes;
      const first = old.revert(), second = old.revert();
      return {
        first, second, global: !!window.__mlsP1TemplateModes,
        labels: Array.from(document.querySelectorAll('#oprTplMode .nm')).map(n => n.firstChild.nodeValue.trim()),
        used: document.querySelector('#oprReceipt b').textContent.trim(),
        redo: document.querySelector('#oprReceipt [data-oprredo]').textContent.trim()
      };
    });
    eq(reverted.first, true, 'owned adapter did not revert');
    eq(reverted.second, false, 'stale adapter reverted twice');
    eq(reverted.global, false, 'revert left the adapter global installed');
    assert.deepStrictEqual(reverted.labels, ['Follow it closely', 'Adapt to the case', 'Use it as a guide — concise']); checks++;
    eq(reverted.used, 'Use it as a guide — concise', 'revert did not restore dynamic receipt text');
    eq(reverted.redo, 'Re-draft: Adapt to the case', 'revert did not restore dynamic redraft text');
    eq(errors.length, 0, 'browser raised adapter errors: ' + errors.join(' | '));
    await page.close();

    for (const pathname of ['/no-preview', '/bad-token']) {
      const blocked = await browser.newPage();
      await blocked.goto(base + pathname, { waitUntil: 'load' });
      await blocked.waitForTimeout(20);
      const result = await blocked.evaluate(() => ({
        api: !!window.__mlsP1TemplateModes,
        label: document.querySelector('#strict .nm').firstChild.nodeValue.trim(),
        storage: localStorage.getItem('sf_u::alpha@example.test::opNoteTemplateMode')
      }));
      eq(result.api, false, pathname + ': adapter installed without exact P1 ownership');
      eq(result.label, 'Follow it closely', pathname + ': regular/unowned control was relabeled');
      eq(result.storage, 'guide', pathname + ': unowned load changed persistence');
      await blocked.close();
    }

    /* Losing the P1 preview boundary at runtime restores shared presentation. */
    const boundaryPage = await browser.newPage();
    await boundaryPage.goto(base + '/', { waitUntil: 'load' });
    await boundaryPage.waitForFunction(() => document.querySelector('#adapt .nm').firstChild.nodeValue.trim() === 'Balanced');
    await boundaryPage.evaluate(() => {
      window.__MLS_P1_PREVIEW.enabled = false;
      document.body.appendChild(document.createElement('i'));
    });
    await boundaryPage.waitForFunction(() => !window.__mlsP1TemplateModes);
    const lost = await boundaryPage.evaluate(() => document.querySelector('#adapt .nm').firstChild.nodeValue.trim());
    eq(lost, 'Adapt to the case', 'lost P1 boundary left P1 text on the shared surface');
    await boundaryPage.close();
  } catch (error) {
    failure = error;
  }
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (failure) throw failure;

  for (const file of regularFiles) {
    eq(digest(file), regularBefore[file], file + ' bytes changed while testing the P1 adapter');
  }
  console.log('PASS /p1 template-mode adapter runtime: ' + checks + ' assertions');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
