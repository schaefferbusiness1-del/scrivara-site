'use strict';
/* __mlsOldBrowserCompat v1.0.0 (b403) — the app must run on old Chrome / old
 * Macs (owner's father: old Mac + old Chrome; pulls relay to the office
 * computer, but the APP itself must load, paint modals, and run progress UI).
 *
 * Proven here:
 *  1. The identical ES5 compat block is inlined in BOTH ScribeFlow.html and
 *     phone.html before app dependencies and contains no post-ES5 syntax.
 *     ScribeFlow's only earlier code is the ES5 one-time-token scrubber, the
 *     exact reviewed preview-policy dependency, and its ES5 fail-closed
 *     fallback. The policy must run before compatibility code so a requested
 *     preview cannot touch native storage/network first; it is inert on every
 *     ordinary route.
 *  2. Runtime: with the modern APIs deleted (simulating old Chrome), the
 *     block restores working Promise.allSettled / Promise.any /
 *     String.replaceAll / at / findLast / flat / hasOwn / fromEntries /
 *     structuredClone / crypto.randomUUID — and never overwrites natives.
 *  3. CSS inset fallback: when CSS.supports('inset','0') is false, every
 *     <style>'s inset shorthand (1–4 values, with or without !important) is
 *     rewritten to top/right/bottom/left, so modal backdrops position
 *     correctly on Chrome <87.
 *  4. Honest floor: when fetch is missing, the plain "update Chrome" banner
 *     is appended instead of silent dead buttons.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const phone = fs.readFileSync(path.join(root, 'phone.html'), 'utf8');

/* ---- 1. presence, ordering, sameness, ES5-ness ---- */
function extractBlock(src, file) {
  const start = src.indexOf('/* __mlsOldBrowserCompat');
  const endMark = '/* end __mlsOldBrowserCompat */';
  const end = src.indexOf(endMark, start);
  assert(start > 0 && end > start, file + ': compat block missing');
  const firstScript = src.indexOf('<script');
  const blockScript = src.lastIndexOf('<script', start);
  if (file === 'phone.html') {
    assert.strictEqual(firstScript, blockScript, file + ': compat block must be the first script');
  } else {
    const earlier = src.slice(firstScript, blockScript);
    assert(earlier.includes('Capture one-time auth handoffs'), file + ': token scrubber must precede compat');
    assert(earlier.includes('If the reviewed preview policy is missing'), file + ': preview fail-closed fallback must precede compat');
    const external = Array.from(earlier.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi), match => match[1]);
    assert.deepStrictEqual(external, ['public-preview-policy.js?v=b489'], file + ': only the exact preview policy may load before compat');
    const policy = fs.readFileSync(path.join(root, 'public-preview-policy.js'), 'utf8');
    const earlyInline = Array.from(earlier.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi), match => match[1]);
    assert.strictEqual(earlyInline.length, 2, file + ': unexpected inline code runs before compat');
    for (const [label, earlyCode] of [['preview policy', policy], ['token scrubber', earlyInline[0]], ['preview fallback', earlyInline[1]]]) {
      new Function(earlyCode);
      const noEarlyStrings = earlyCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
      assert(!/=>|`|\b(?:let|const|async|await)\b/.test(noEarlyStrings), file + ': early ' + label + ' must remain ES5 syntax');
    }
  }
  return src.slice(start, end + endMark.length);
}
const blockA = extractBlock(app, 'ScribeFlow.html');
const blockB = extractBlock(phone, 'phone.html');
assert.strictEqual(blockA, blockB, 'the two compat blocks must stay byte-identical');

const code = blockA.slice(0, blockA.lastIndexOf('/* end'));
new Function(code); // syntax gate
/* the block itself must parse on old Chrome: ES5 only (the async/spread text
   lives INSIDE a probe string literal, which is fine) */
const noStrings = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
assert(!/=>/.test(noStrings), 'compat block must not use arrow functions');
assert(!/`/.test(noStrings), 'compat block must not use template literals');
assert(!/\b(let|const|async|await)\b/.test(noStrings), 'compat block must not use post-ES5 keywords');

/* ---- 2 + 3 + 4. runtime in a stripped "old Chrome" sandbox ---- */
function makeOldChrome(opts) {
  const styleEl = {
    textContent: '#a{position:fixed;inset:0;background:#000}.b{inset:4px 8px!important}.c{inset:1px 2px 3px 4px;color:red}',
    __style: true
  };
  const appended = [];
  const timers = [];
  const doc = {
    readyState: 'complete',
    body: {
      appendChild(el) { appended.push(el); return el; }
    },
    getElementById() { return null; },
    createElement() { return { style: {}, set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } }; },
    querySelectorAll(sel) { return sel === 'style' ? [styleEl] : []; },
    addEventListener() {}
  };
  const ctx = {
    console, JSON, Math,
    document: doc,
    setTimeout(fn, ms) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    MutationObserver: function () { this.observe = function () {}; },
    CSS: { supports() { return false; } } /* old Chrome: no inset support */
  };
  ctx.window = ctx;
  ctx.window.crypto = {};
  if (!opts || opts.fetch !== false) ctx.fetch = function () {};
  vm.createContext(ctx);
  /* simulate old Chrome: strip the modern APIs from this realm */
  vm.runInContext(`
    delete Promise.allSettled; delete Promise.any;
    delete String.prototype.replaceAll; delete String.prototype.at;
    delete Array.prototype.at; delete Array.prototype.findLast;
    delete Array.prototype.findLastIndex; delete Array.prototype.flat;
    delete Array.prototype.flatMap; delete Object.hasOwn; delete Object.fromEntries;
  `, ctx);
  vm.runInContext(code, ctx);
  return { ctx, styleEl, appended, timers };
}

{ /* polyfills restore working APIs */
  const { ctx, styleEl, timers } = makeOldChrome();
  const out = vm.runInContext(`(function(){
    var r = {};
    r.patched = window.__mlsOldBrowserCompat.patched.slice();
    r.tooOld = window.__mlsOldBrowserCompat.tooOld;
    r.at = 'abcde'.at(-1) + '|' + [1,2,3].at(-2);
    r.repAll = 'a.b.a.b'.replaceAll('.b', '!');
    r.findLast = [1,2,3,4].findLast(function(x){ return x < 4; });
    r.flat = JSON.stringify([1,[2,[3]]].flat(2));
    r.hasOwn = Object.hasOwn({ q: 1 }, 'q');
    r.fromEntries = JSON.stringify(Object.fromEntries([['k','v']]));
    r.clone = (function(){ var o = { a: { b: 2 } }; var c = structuredClone(o); return c.a.b === 2 && c.a !== o.a; })();
    r.uuid = crypto.randomUUID();
    return r;
  })()`, ctx);
  assert.strictEqual(out.tooOld, false, 'a browser with fetch+Promise is not "too old"');
  assert.strictEqual(out.at, 'e|2', 'String/Array.at polyfill broken');
  assert.strictEqual(out.repAll, 'a!.a!', 'replaceAll polyfill broken (dot must not be a wildcard)');
  assert.strictEqual(out.findLast, 3, 'findLast polyfill broken');
  assert.strictEqual(out.flat, '[1,2,3]', 'flat polyfill broken');
  assert.strictEqual(out.hasOwn, true, 'hasOwn polyfill broken');
  assert.strictEqual(out.fromEntries, '{"k":"v"}', 'fromEntries polyfill broken');
  assert.strictEqual(out.clone, true, 'structuredClone fallback broken');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(out.uuid),
    'randomUUID fallback must produce a v4-shaped id');
  assert(out.patched.indexOf('allSettled') >= 0 && out.patched.indexOf('css-inset') >= 0,
    'patched ledger must record what was installed');

  /* allSettled + any actually resolve */
  return_allSettled(ctx);

  /* inset patcher: run the scheduled patch */
  timers.forEach((fn) => fn());
  assert(styleEl.textContent.includes('top:0;right:0;bottom:0;left:0'),
    'inset:0 was not expanded (modals would misposition on Chrome <87)');
  assert(styleEl.textContent.includes('top:4px!important;right:8px!important;bottom:4px!important;left:8px!important'),
    'two-value inset with !important was not expanded correctly');
  assert(styleEl.textContent.includes('top:1px;right:2px;bottom:3px;left:4px'),
    'four-value inset was not expanded correctly');
  assert(!styleEl.textContent.match(/[;{\s]inset\s*:/), 'no raw inset declarations may remain');
}

function return_allSettled(ctx) {
  let done = false;
  vm.runInContext(`
    Promise.allSettled([Promise.resolve(1), Promise.reject(new Error('x'))]).then(function (r) {
      window.__asOk = r.length === 2 && r[0].status === 'fulfilled' && r[0].value === 1 && r[1].status === 'rejected';
    });
    Promise.any([Promise.reject(new Error('a')), Promise.resolve(7)]).then(function (v) { window.__anyOk = v === 7; });
  `, ctx);
  return new Promise((resolve) => setImmediate(() => {
    setImmediate(() => {
      assert.strictEqual(ctx.__asOk, true, 'allSettled polyfill does not settle correctly');
      assert.strictEqual(ctx.__anyOk, true, 'Promise.any polyfill does not resolve correctly');
      done = true;
      resolve();
    });
  })).then(() => assert(done));
}

{ /* natives are never overwritten on modern browsers */
  const styleEl = { textContent: '#a{inset:0}' };
  const ctx = {
    console, JSON, Math,
    document: { readyState: 'complete', body: { appendChild() {} }, getElementById() { return null; }, createElement() { return {}; }, querySelectorAll() { return [styleEl]; }, addEventListener() {} },
    setTimeout(fn) { return 1; }, clearTimeout() {},
    MutationObserver: function () { this.observe = function () {}; },
    CSS: { supports() { return true; } }, /* modern: inset supported */
    fetch() {}
  };
  ctx.window = ctx; ctx.window.crypto = { randomUUID() { return 'native'; } };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const patched = vm.runInContext('window.__mlsOldBrowserCompat.patched.slice()', ctx);
  assert(patched.indexOf('css-inset') < 0, 'inset patcher must stay disarmed when the browser supports inset');
  assert.strictEqual(vm.runInContext('crypto.randomUUID()', ctx), 'native', 'native randomUUID must never be replaced');
  assert.strictEqual(styleEl.textContent, '#a{inset:0}', 'styles must be untouched on modern browsers');
}

{ /* honest floor: no fetch -> banner, not silence */
  const { ctx, appended } = makeOldChrome({ fetch: false });
  assert.strictEqual(vm.runInContext('window.__mlsOldBrowserCompat.tooOld', ctx), true, 'a fetch-less browser must be flagged too old');
  assert.strictEqual(appended.length, 1, 'the too-old banner must be appended');
  assert.strictEqual(appended[0].id, 'mlsOldChromeBar', 'banner id changed');
  assert(/update Chrome/i.test(appended[0].textContent), 'the banner must tell the user to update Chrome');
}

console.log('PASS old-browser compat: identical first-script ES5 block in app+phone, polyfills restore old Chrome (allSettled/any/replaceAll/at/findLast/flat/hasOwn/fromEntries/structuredClone/randomUUID), inset shorthand expands so modals position on Chrome <87, natives untouched on modern browsers, and a too-old browser gets an honest update banner');
