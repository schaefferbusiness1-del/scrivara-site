'use strict';

/* P1 AVATAR CAPABILITY LOADER
 * Real Chrome executes the exact controller and instant-card hook from the
 * preview connector. The Avatar body is a PHI-free synthetic owner so takeover,
 * dormant, failure, and stale-callback states can be forced deterministically.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const marker = connect.indexOf('/* p1-avatar-loader-1.0.0:');
const controllerStart = connect.indexOf(';(function(){try{', marker);
const controllerEndMark = '}catch(e){}})();';
const controllerEnd = connect.indexOf(controllerEndMark, controllerStart);
const skeletonMarker = connect.indexOf('/* av-6.0.8:', controllerEnd);
const skeletonStart = connect.indexOf(';(function(){try{', skeletonMarker);
const skeletonEnd = connect.indexOf(controllerEndMark, skeletonStart);
assert(marker >= 0 && controllerStart > marker && controllerEnd > controllerStart,
  'could not isolate the canonical Avatar controller');
assert(skeletonMarker > controllerEnd && skeletonStart > skeletonMarker && skeletonEnd > skeletonStart,
  'could not isolate the Avatar skeleton delegate');
const loader = connect.slice(controllerStart, controllerEnd + controllerEndMark.length) + '\n' +
  connect.slice(skeletonStart, skeletonEnd + controllerEndMark.length);

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

eq((loader.match(/document\.createElement\('script'\)/g) || []).length, 1,
  'the consolidated Avatar loader has more than one script creator');
ok(/data-mls-install-token/.test(loader) && /exactOwner/.test(loader),
  'loader lost capability-token owner validation');
ok(!/__mlsDeferAsset[\s\S]*createElement\('script'\)[\s\S]*mountSkeleton[\s\S]*createElement\('script'\)/.test(loader),
  'deferred and skeleton paths became separate script creators again');

const syntheticAsset = String.raw`(function(){
  var node=document.currentScript,token=String(node&&node.getAttribute('data-mls-install-token')||''),mode=window.__assetMode||'active';
  window.__assetInstalls=(window.__assetInstalls||0)+1;
  if(mode==='malformed-loaded'){
    window.__mlsAvatar={installed:true,asset:'feat_mls_avatar.js',version:'av-5.7.0',installToken:token,revert:function(){window.__malformedRevert=(window.__malformedRevert||0)+1;return true;}};
    return;
  }
  var instance='synthetic-instance-'+window.__assetInstalls;
  var api={installed:mode!=='dormant',asset:'feat_mls_avatar.js',version:'av-5.7.0',installToken:token,instanceToken:instance};
  if(mode==='dormant')api.dormant='no-authenticated-session';
  api.isDirty=function(){return mode==='dormant'?false:window.__assetDirty===true;};
  api.revert=function(){
    window.__assetReverts=(window.__assetReverts||0)+1;
    if(window.__mlsAvatar!==api)return false;
    api.installed=false;
    if(window.__mlsAvP1Mic){window.__mlsAvP1Mic.installed=false;delete window.__mlsAvP1Mic;}
    delete window.__mlsAvatar;return true;
  };
  window.__mlsAvatar=api;
  if(mode!=='dormant')window.__mlsAvP1Mic={installed:true,v:'p1-mic-1.0.0',installToken:token,
    instanceToken:mode==='mismatch-mic'?instance+'-wrong':instance,state:function(){return {};},
    revert:function(){this.installed=false;return true;}};
})();`;

function priorOwnerScript(mode) {
  if (!/^prior-/.test(mode)) return '';
  if (mode === 'prior-malformed') return `
    window.__mlsAvatar={installed:true,asset:'feat_mls_avatar.js',version:'av-5.6.0',revert:function(){window.__foreignRevert=(window.__foreignRevert||0)+1;return true;}};`;
  const dirty = mode === 'prior-dirty' ? 'true' : 'false';
  return `
    (function(){var token='old-exact-token',instance='old-exact-instance';
      var tag=document.createElement('script');tag.setAttribute('data-mls-asset','feat_mls_avatar.js');tag.setAttribute('data-mls-install-token',token);document.head.appendChild(tag);
      var api={installed:true,asset:'feat_mls_avatar.js',version:'av-5.6.0',installToken:token,instanceToken:instance,
        isDirty:function(){return ${dirty};},revert:function(){window.__priorReverts++;api.installed=false;mic.installed=false;delete window.__mlsAvatar;delete window.__mlsAvP1Mic;return true;}};
      var mic={installed:true,v:'p1-mic-1.0.0',installToken:token,instanceToken:instance,state:function(){return {};},revert:function(){mic.installed=false;return true;}};
      window.__mlsAvatar=api;window.__mlsAvP1Mic=mic;
    })();`;
}

function pageHtml(mode) {
  const malformedController = mode === 'malformed-controller' ? `
    window.__malformedCtl={installed:true,version:'p1-avatar-loader-1.0.0',ensure:function(){return true;}};
    window.__mlsP1AvatarLoader=window.__malformedCtl;` : '';
  const foreignTag = mode === 'foreign-tag' ? `
    (function(){var tag=document.createElement('script');tag.setAttribute('data-mls-asset','feat_mls_avatar.js');document.head.appendChild(tag);})();` : '';
  const foreignSkeleton = mode === 'foreign-skeleton' ? `
    window.__foreignSkeletonRequested=true;` : '';
  const assetMode = mode === 'dormant' || mode === 'mismatch-mic' || mode === 'malformed-loaded' ? mode :
    mode === 'network-error' ? 'network-error' : 'active';
  return `<!doctype html><html><head><meta charset="utf-8"><script>
    window.__MLS_P1_PREVIEW={enabled:true,route:'/1p/'};window.__MLS_AV='${assetMode}';window.__assetMode='${assetMode}';
    window.__deferred=[];window.__mlsDeferAsset=function(fn){window.__deferred.push(fn);return window.__deferred.length;};
    window.__upgradeDefers=[];window.__upgradeClears=[];window.__mlsUpgradeSafety={defer:function(key,label,reasons){window.__upgradeDefers.push({key:key,label:label,reasons:reasons});},clear:function(key){window.__upgradeClears.push(key);}};
    window.__priorReverts=0;${malformedController}${foreignTag}${foreignSkeleton}${priorOwnerScript(mode)}
  </script></head><body><div id="visitView"><div id="mlsStages"></div><div id="workspace"></div></div><script>
    if(window.__foreignSkeletonRequested){var card=document.createElement('div');card.id='mlsAvVisitCard';card.setAttribute('data-mls-av-skeleton','1');card.setAttribute('data-mls-avatar-loader-token','foreign-loader-token');document.getElementById('visitView').appendChild(card);}
  </script>
  <script src="/loader.js"></script></body></html>`;
}

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/loader.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(loader);
      }
      if (url.pathname === '/1p-feat_mls_avatar.js') {
        if (url.searchParams.get('v') === 'network-error') { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(syntheticAsset);
      }
      const mode = url.searchParams.get('mode') || 'active';
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(pageHtml(mode));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function open(browser, base, mode) {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error && error.message || error)));
  await page.goto(base + '/?mode=' + encodeURIComponent(mode || 'active'), { waitUntil: 'load' });
  return { page, errors };
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failure = null;
  try {
    /* Instant skeleton, one capability tag, exact active+mic proof, and reuse. */
    {
      const { page, errors } = await open(browser, base, 'active');
      await page.waitForFunction(() => document.querySelector('[data-mls-av-skeleton="1"]'));
      const before = await page.evaluate(() => ({
        card: document.getElementById('mlsAvVisitCard').textContent,
        tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length,
        token: document.getElementById('mlsAvVisitCard').getAttribute('data-mls-avatar-loader-token') === window.__mlsP1AvatarLoader.installToken
      }));
      ok(/Avatar/.test(before.card) && /ready/i.test(before.card), 'instant card is not an honest loading skeleton');
      eq(before.tags, 0, 'painting the instant card started the Avatar fetch');
      eq(before.token, true, 'instant card is not owned by the exact controller token');
      await page.evaluate(() => window.__mlsP1AvatarLoader.ensure('test'));
      await page.waitForFunction(() => window.__mlsP1AvatarLoader.state === 'ready');
      const ready = await page.evaluate(() => ({
        tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length,
        installs: window.__assetInstalls, token: window.__mlsAvatar.installToken,
        ctlToken: window.__mlsP1AvatarLoader.installToken, instance: window.__mlsAvatar.instanceToken,
        micInstance: window.__mlsAvP1Mic.instanceToken, skeleton: !!document.querySelector('[data-mls-av-skeleton="1"]')
      }));
      eq(ready.tags, 1, 'active Avatar did not settle to one canonical tag');
      eq(ready.installs, 1, 'active Avatar evaluated more than once');
      eq(ready.token, ready.ctlToken, 'active Avatar owner lost the loader capability');
      eq(ready.instance, ready.micInstance, 'active Avatar mic is not the same exact instance');
      eq(ready.skeleton, false, 'loading skeleton survived after the exact owner became ready');
      await page.evaluate(() => { window.__mlsP1AvatarLoader.ensure(); window.__mlsP1AvatarLoader.ensure(); });
      const reused = await page.evaluate(() => ({ tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length, installs: window.__assetInstalls }));
      eq(reused.tags, 1, 'repeated ensure duplicated the canonical Avatar tag');
      eq(reused.installs, 1, 'repeated ensure re-evaluated the Avatar');

      /* A retired controller's saved callbacks cannot touch its replacement. */
      await page.evaluate(() => {
        window.__oldCtl = window.__mlsP1AvatarLoader; window.__oldApi = window.__mlsAvatar;
        window.__oldNode = window.__oldCtl.node; window.__oldOnload = window.__oldNode.onload; window.__oldOnerror = window.__oldNode.onerror;
        window.__oldCtl.revert();
      });
      const retired = await page.evaluate(() => ({ ctl: window.__oldCtl.installed, api: window.__oldApi.installed, primary: !!window.__mlsAvatar, mic: !!window.__mlsAvP1Mic }));
      eq(retired.ctl, false, 'exact controller revert left the controller installed');
      eq(retired.api, false, 'exact controller revert left its owner installed');
      eq(retired.primary, false, 'exact controller revert left the primary global');
      eq(retired.mic, false, 'exact controller revert left the mic global');
      await page.evaluate(() => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/loader.js?refresh=1'; s.onload = resolve; s.onerror = reject; document.body.appendChild(s); }));
      await page.evaluate(() => window.__mlsP1AvatarLoader.ensure('refresh'));
      await page.waitForFunction(() => window.__mlsP1AvatarLoader.state === 'ready');
      const stale = await page.evaluate(() => {
        const newCtl = window.__mlsP1AvatarLoader, newApi = window.__mlsAvatar;
        const a = window.__oldCtl.ensure(), b = window.__oldCtl.revert(); window.__oldOnload(); window.__oldOnerror();
        return { a, b, sameCtl: window.__mlsP1AvatarLoader === newCtl, sameApi: window.__mlsAvatar === newApi,
          ready: newCtl.state, tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length };
      });
      eq(stale.a, false, 'stale controller ensure became active');
      eq(stale.b, false, 'stale controller reverted its replacement');
      eq(stale.sameCtl, true, 'stale callback replaced the new controller');
      eq(stale.sameApi, true, 'stale callback damaged the new Avatar owner');
      eq(stale.ready, 'ready', 'stale callback changed the replacement state');
      eq(stale.tags, 1, 'stale callback duplicated or removed the replacement tag');
      eq(errors.length, 0, 'active/replacement runtime raised page errors: ' + errors.join(' | '));
      await page.close();
    }

    /* A clean exact old owner is retired; dirty work is preserved and deferred. */
    {
      const { page, errors } = await open(browser, base, 'prior-clean');
      await page.evaluate(() => window.__mlsP1AvatarLoader.ensure('upgrade'));
      await page.waitForFunction(() => window.__mlsP1AvatarLoader.state === 'ready');
      const result = await page.evaluate(() => ({ reverts: window.__priorReverts, token: window.__mlsAvatar.installToken,
        ctlToken: window.__mlsP1AvatarLoader.installToken, tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length }));
      eq(result.reverts, 1, 'clean exact prior owner was not retired once');
      eq(result.token, result.ctlToken, 'clean upgrade did not install the new exact capability');
      eq(result.tags, 1, 'clean upgrade did not retire the prior owner tag');
      eq(errors.length, 0, 'clean upgrade raised page errors: ' + errors.join(' | '));
      await page.close();
    }
    {
      const { page } = await open(browser, base, 'prior-dirty');
      const value = await page.evaluate(() => window.__mlsP1AvatarLoader.ensure('upgrade'));
      const result = await page.evaluate(value => ({ value, state: window.__mlsP1AvatarLoader.state, reverts: window.__priorReverts,
        old: window.__mlsAvatar && window.__mlsAvatar.installToken, installs: window.__assetInstalls || 0, notices: window.__upgradeDefers.length }), value);
      eq(result.value, false, 'dirty prior owner allowed an upgrade');
      eq(result.state, 'blocked-dirty-owner', 'dirty owner did not enter the explicit deferred state');
      eq(result.reverts, 0, 'dirty prior owner was reverted');
      eq(result.old, 'old-exact-token', 'dirty prior owner was overwritten');
      eq(result.installs, 0, 'dirty prior owner allowed new asset execution');
      ok(result.notices > 0, 'dirty-owner deferral was not surfaced');
      await page.close();
    }

    /* Dormant is a complete signed-out owner with no microphone. */
    {
      const { page } = await open(browser, base, 'dormant');
      await page.evaluate(() => window.__mlsP1AvatarLoader.ensure('dormant'));
      await page.waitForFunction(() => window.__mlsP1AvatarLoader.state === 'ready-dormant');
      const result = await page.evaluate(() => ({ installed: window.__mlsAvatar.installed, dormant: window.__mlsAvatar.dormant,
        mic: !!window.__mlsAvP1Mic, dirty: window.__mlsAvatar.isDirty(), tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length }));
      eq(result.installed, false, 'signed-out Avatar owner claimed to be active');
      ok(!!result.dormant, 'signed-out Avatar owner did not identify itself as dormant');
      eq(result.mic, false, 'dormant Avatar retained a live mic owner');
      eq(result.dirty, false, 'dormant Avatar did not report clean');
      eq(result.tags, 1, 'dormant Avatar did not retain exactly one canonical tag');
      await page.close();
    }

    /* Malformed/foreign owners and mismatched mic instances fail closed. */
    for (const mode of ['prior-malformed', 'mismatch-mic', 'malformed-loaded', 'foreign-tag', 'foreign-skeleton']) {
      const { page } = await open(browser, base, mode);
      await page.evaluate(() => window.__mlsP1AvatarLoader.ensure('negative'));
      await page.waitForFunction(() => /^blocked-/.test(window.__mlsP1AvatarLoader.state));
      const result = await page.evaluate(() => ({ state: window.__mlsP1AvatarLoader.state,
        attempts: window.__mlsP1AvatarLoader.attempts, foreignRevert: window.__foreignRevert || 0,
        malformedRevert: window.__malformedRevert || 0, notices: window.__upgradeDefers.length }));
      ok(/^blocked-/.test(result.state), mode + ' did not fail closed');
      eq(result.foreignRevert, 0, mode + ' called an unproven foreign revert');
      eq(result.malformedRevert, 0, mode + ' called a malformed loaded-owner revert');
      ok(result.notices > 0, mode + ' refusal was not surfaced');
      if (mode === 'mismatch-mic' || mode === 'malformed-loaded') eq(result.attempts, 1, mode + ' was retried as a network failure');
      if (mode === 'foreign-skeleton') eq(result.attempts, 0, 'foreign skeleton allowed an Avatar asset attempt');
      await page.close();
    }

    /* A malformed controller is not overwritten or invoked. */
    {
      const { page } = await open(browser, base, 'malformed-controller');
      const result = await page.evaluate(() => ({ same: window.__mlsP1AvatarLoader === window.__malformedCtl,
        refusal: window.__mlsAvatarLoadRefusal && window.__mlsAvatarLoadRefusal.reason,
        tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length }));
      eq(result.same, true, 'malformed incumbent controller was overwritten');
      eq(result.refusal, 'blocked-foreign-controller', 'malformed controller refusal was not explicit');
      eq(result.tags, 0, 'malformed controller allowed an Avatar load');
      await page.close();
    }

    /* Genuine network failure retries exactly once, then removes the lie. */
    {
      const { page } = await open(browser, base, 'network-error');
      await page.evaluate(() => window.__mlsP1AvatarLoader.ensure('network'));
      await page.waitForFunction(() => window.__mlsP1AvatarLoader.state === 'failed-bounded', null, { timeout: 5000 });
      const result = await page.evaluate(() => ({ attempts: window.__mlsP1AvatarLoader.attempts,
        tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length,
        skeleton: !!document.querySelector('[data-mls-av-skeleton="1"]') }));
      eq(result.attempts, 2, 'network failure exceeded or skipped the bounded retry');
      eq(result.tags, 0, 'failed bounded load left a canonical loading tag');
      eq(result.skeleton, false, 'failed bounded load left a card that can never work');
      await page.close();
    }

    /* Withdrawing the P1 marker tears down an exact clean owner and blocks reload. */
    {
      const { page } = await open(browser, base, 'active');
      await page.evaluate(() => window.__mlsP1AvatarLoader.ensure('preview'));
      await page.waitForFunction(() => window.__mlsP1AvatarLoader.state === 'ready');
      const result = await page.evaluate(() => {
        window.__MLS_P1_PREVIEW.enabled = false;
        const value = window.__mlsP1AvatarLoader.ensure('withdrawn');
        const again = window.__mlsP1AvatarLoader.ensure('withdrawn-again');
        return { value, again, state: window.__mlsP1AvatarLoader.state, owner: !!window.__mlsAvatar,
          mic: !!window.__mlsAvP1Mic, tags: document.querySelectorAll('script[data-mls-asset="feat_mls_avatar.js"]').length,
          finalRevert: window.__mlsP1AvatarLoader.revert() };
      });
      eq(result.value, false, 'preview withdrawal reported active behavior');
      eq(result.again, false, 'preview withdrawal allowed a second load');
      eq(result.state, 'blocked-preview', 'preview withdrawal did not enter blocked-preview');
      eq(result.owner, false, 'preview withdrawal left the primary owner active');
      eq(result.mic, false, 'preview withdrawal left the mic owner active');
      eq(result.tags, 0, 'preview withdrawal left the owned script tag');
      eq(result.finalRevert, true, 'preview withdrawal prevented exact controller teardown');
      await page.close();
    }
  } catch (error) { failure = error; }
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (failure) throw failure;
  console.log('PASS P1 Avatar capability loader runtime: ' + checks + ' assertions');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
