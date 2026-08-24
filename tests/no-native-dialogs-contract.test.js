'use strict';
/* 2026-07-22: native confirm()/prompt()/alert() freeze the UI thread (and are
 * silently suppressed in kiosk/automation contexts, leaving dead buttons).
 * Every production-loaded script must use the non-blocking in-app dialogs
 * (mlsConfirm/mlsPrompt, promise-based) or the toast pipeline.
 *
 * Allowed residue:
 *   - the helper definitions themselves (they wrap the fallback)
 *   - the `(window.toast||window.alert)` idiom — native only reachable when
 *     the toast pipeline itself is gone (a broken page)
 *   - comments
 *
 * Also pins: the in-app dialog helpers exist in ScribeFlow.html, are
 * promise-based, trap Escape/Enter, restore focus, and mlsPrompt returns
 * null on cancel exactly like native prompt.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const conn = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* -------- 1. scan every production-loaded script -------- */
const loaded = new Set(['mls-connect.js']);
const refRe = /["']((?:feat_|mls-)[A-Za-z0-9_.-]+\.js)["']/g;
let m;
for (const src of [conn, app]) {
  refRe.lastIndex = 0;
  while ((m = refRe.exec(src))) loaded.add(m[1]);
}
assert(loaded.size > 100, 'loader scan looks broken — only ' + loaded.size + ' scripts found');

const offenders = [];
const nativeDialogCall = /(?:^|[^.\w"'])(?:window\.)?(confirm|prompt|alert)\((?!\?:)/;
assert(nativeDialogCall.test("if (ready) confirm('continue?');"), 'native-dialog scanner positive control is broken');
assert(!nativeDialogCall.test('var diagnosisCue = /confirm(?:s|ed)?/i;'), 'native-dialog scanner mistakes a regex non-capturing group for a call');
function scan(name, source) {
  source.split('\n').forEach((line, i) => {
    if (/\(window\.toast\|\|window\.alert\)/.test(line)) return;
    /* toast-first with alert only when the toast pipeline is absent (pinned
       verbatim by perf-sweep-contract for the patient-lock switch path) */
    if (/typeof window\.toast === ['"]function['"]/.test(line)) return;
    if (/mlsConfirm|mlsPrompt/.test(line)) return;
    const code = line.replace(/\/\/.*$/, '');
    if (nativeDialogCall.test(code) &&
        !/PromptForChoice|prompt\(\)|confirm\(\)|alert\(\)/.test(code)) {
      offenders.push(name + ':' + (i + 1) + ': ' + line.trim().slice(0, 110));
    }
  });
}
/* 2026-07-22 extension: not just the loader graph — EVERY feat_ and mls-
   module file in the repo plus both shells stays native-dialog-free, so a
   dormant module can never re-introduce a thread-freezing dialog later. */
const everyModule = fs.readdirSync(root).filter(f => /^feat_.*\.js$|^mls-.*\.js$/.test(f));
const scanSet = new Set([...loaded, ...everyModule, 'ScribeFlow-staging.html']);
for (const f of [...scanSet].sort()) {
  let s;
  try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
  scan(f, s);
}
/* async array predicates are the conversion's known failure mode: an async
   find/filter/some predicate is always-truthy and silently matches the wrong
   row — none may exist anywhere */
for (const f of [...scanSet].sort()) {
  let s;
  try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
  const m = s.match(/\.(?:find|findIndex|filter|some|every)\(\s*async\s/g);
  assert(!m, f + ': async array predicate introduced (always-truthy match): ' + (m && m.length));
}
/* staging shell carries its own copy of the promise helpers */
const stagingShell = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
assert(stagingShell.includes('function mlsConfirm(msg,opts){') && stagingShell.includes('function mlsPrompt(msg,def,opts){'),
  'staging shell lost its non-blocking dialog helpers');
/* the app shell itself (inline scripts) */
const inlineRe = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
let block, bi = 0;
while ((block = inlineRe.exec(app))) { bi++; scan('ScribeFlow.html#inline' + bi, block[1]); }

assert.strictEqual(offenders.length, 0,
  'native blocking dialogs found in production scripts:\n' + offenders.join('\n'));

/* -------- 2. helper contract (source anchors) -------- */
assert(app.includes('function mlsConfirm(msg,opts){'), 'mlsConfirm helper missing');
assert(app.includes('function mlsPrompt(msg,def,opts){'), 'mlsPrompt helper missing');
assert(app.includes('window.mlsConfirm=mlsConfirm; window.mlsPrompt=mlsPrompt;'), 'helpers are not exported for feat modules');
const base = app.slice(app.indexOf('function _mlsDialogBase'), app.indexOf('window.mlsConfirm=mlsConfirm'));
assert(base.includes("e.key==='Escape'") && base.includes("e.key==='Enter'"), 'dialog base lost its keyboard handling');
assert(base.includes('prevFocus') && base.includes('prevFocus.focus()'), 'dialog base does not restore focus');
assert(base.includes("setAttribute('role','dialog')") && base.includes("'aria-modal','true'"), 'dialog base lost its ARIA contract');
/* the connector guarantees the helpers exist even on shells without them */
assert(conn.includes("if(typeof window.mlsConfirm!=='function')") && conn.includes("if(typeof window.mlsPrompt!=='function')"),
  'mls-connect fallback helper guarantee missing');

/* -------- 3. runtime behavior of the helpers (jsdom-free DOM stub) -------- */
function domStub() {
  const listeners = {};
  function makeEl(tag) {
    const el = {
      tag, children: [], style: {}, attrs: {}, _html: '',
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parent = this; return c; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
      addEventListener(t, fn) { (this._ev = this._ev || {})[t] = fn; },
      querySelector(sel) {
        // the helpers only query by #id
        const id = String(sel).replace('#', '');
        return byIdDeep(this, id);
      },
      focus() { doc._focused = this; }, select() {},
      onclick: null
    };
    return el;
  }
  function byIdDeep(el, id) {
    // ids live in innerHTML strings — the helpers query buttons/inputs they
    // just created. Emulate by materializing on demand.
    if (!el._materialized && el._html) {
      el._materialized = {};
      const idRe = /id="(_mlsAsk[A-Za-z]+)"/g;
      let mm;
      while ((mm = idRe.exec(el._html))) {
        const child = makeEl('div');
        child.id = mm[1];
        if (/Input/.test(mm[1])) child.value = '';
        el._materialized[mm[1]] = child;
      }
    }
    return (el._materialized && el._materialized[id]) || null;
  }
  const body = makeEl('body');
  const doc = {
    body,
    getElementById(id) { return null; },
    createElement(tag) { return makeEl(tag); },
    addEventListener(t, fn) { listeners[t] = fn; },
    removeEventListener(t) { delete listeners[t]; },
    activeElement: null,
    _listeners: listeners
  };
  return doc;
}
const helperStart = app.indexOf('var _mlsAskActive=null');
assert(helperStart >= 0, 'active-dialog registry declaration missing');
const helperSrc = app.slice(helperStart, app.indexOf('window.mlsConfirm=mlsConfirm; window.mlsPrompt=mlsPrompt;'));
const ctx = { console, Promise, Object, Array, String, JSON, Date, Math, document: domStub(), esc: s => String(s == null ? '' : s), window: {} };
vm.createContext(ctx);
vm.runInContext(helperSrc + '\nthis.mlsConfirm=mlsConfirm; this.mlsPrompt=mlsPrompt;', ctx, { filename: 'dialog-helpers.js' });

(async () => {
  /* confirm resolves true via the yes button */
  const p1 = ctx.mlsConfirm('Really?');
  const card1 = ctx.document.body.children[0].children[0];
  const yes1 = card1.querySelector('#_mlsAskYes');
  assert(yes1, 'confirm dialog did not render a yes button');
  yes1.onclick();
  assert.strictEqual(await p1, true, 'confirm OK did not resolve true');
  assert.strictEqual(ctx.document.body.children.length, 0, 'confirm did not remove its overlay');

  /* Escape resolves false and never leaves the promise hanging */
  const p2 = ctx.mlsConfirm('Really?');
  ctx.document._listeners.keydown({ key: 'Escape', stopPropagation() {} });
  assert.strictEqual(await p2, false, 'Escape did not cancel the confirm');

  /* prompt: cancel resolves null (native parity), OK resolves the input value */
  const p3 = ctx.mlsPrompt('Name?', 'default');
  const card3 = ctx.document.body.children[0].children[0];
  card3.querySelector('#_mlsAskNo').onclick();
  assert.strictEqual(await p3, null, 'prompt cancel did not resolve null');

  const p4 = ctx.mlsPrompt('Name?', 'seed');
  const card4 = ctx.document.body.children[0].children[0];
  const input4 = card4.querySelector('#_mlsAskInput');
  input4.value = 'typed value';
  card4.querySelector('#_mlsAskYes').onclick();
  assert.strictEqual(await p4, 'typed value', 'prompt OK did not resolve the typed value');

  /* 2026-07-22 hardening: a NEW dialog must RESOLVE the one it replaces (as
     cancelled) — a bare removal orphaned the old promise forever (deadlocking
     single-flight callers like the consent gate) and leaked its keydown
     listener so one Enter could fire two confirms. */
  const pOld = ctx.mlsConfirm('First?');
  const pNew = ctx.mlsConfirm('Second?');
  const settledOld = await Promise.race([pOld, new Promise(r => setImmediate(() => r('PENDING')))]);
  assert.strictEqual(settledOld, false, 'a replaced dialog did not resolve as cancelled: ' + settledOld);
  const cardNew = ctx.document.body.children[0].children[0];
  cardNew.querySelector('#_mlsAskYes').onclick();
  assert.strictEqual(await pNew, true, 'the replacing dialog broke');
  assert(helperSrc.includes('_mlsAskActive'), 'active-dialog registry missing from source');

  console.log('PASS no-native-dialogs: ' + loaded.size + ' production scripts clean, promise helpers keyboard/focus/ARIA-complete with native prompt parity');
})().catch(e => { console.error(e); process.exit(1); });
