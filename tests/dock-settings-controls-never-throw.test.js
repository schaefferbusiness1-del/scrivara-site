'use strict';
/*
 * The two dock settings controls must work whether or not the scripts that own
 * them have landed.
 *
 * Both call into code that is loaded dynamically, not linked:
 *   applyDockSidePreview      feat_mls_calm_shell.js, queued by the deferred
 *                             asset scheduler with fallback:'classic'
 *   applyDockAutoHidePreview  mls-connect.js, which also DELETES the function
 *                             again in its own retire path
 * so there are real windows in which neither exists. The inline handlers used
 * to call them bare, which threw ReferenceError and left the control dead and
 * silent - and public-inline-handler-contract could not see it, because its
 * resolver counted the surrounding `typeof x === 'function'` guards as
 * definitions (fixed in the same change as this file, inlinedef-1.0.0).
 *
 * This EXECUTES the shipped handlers in both worlds. A source grep would only
 * pin the spelling of a guard; the point is the behaviour when the dependency
 * is missing.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
const ALLOWED_SIDES = ['bottom', 'top', 'left', 'right'];

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* Lift a top-level function by brace matching, so what runs is the shipped
   body and not a paraphrase of it. */
function lift(src, name, shell) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, shell + ' no longer defines ' + name + ' - the inline handler would be unresolved again');
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > start, shell + ': could not brace-match ' + name);
  return src.slice(start, end);
}

function world(opts) {
  const store = Object.create(null);
  const calls = [];
  const sandbox = {
    console,
    document: {
      getElementById(id) {
        if (id !== 'qolDockSide' || opts.noSelect) return null;
        return { options: ALLOWED_SIDES.map((v) => ({ value: v })) };
      }
    },
    localStorage: {
      setItem(k, v) { store[String(k)] = String(v); },
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, String(k)) ? store[String(k)] : null; }
    },
    uns(k) { return 'sf_u::' + k; }
  };
  sandbox.window = sandbox;
  if (opts.sideFn) sandbox.applyDockSidePreview = function (s) { calls.push(['side', s]); };
  if (opts.autoFn) sandbox.applyDockAutoHidePreview = function (b) { calls.push(['auto', b]); };
  return { sandbox, store, calls };
}

for (const shell of SHELLS) {
  const src = fs.readFileSync(path.join(ROOT, shell), 'utf8');

  /* The handlers must name these functions - not the raw dependency. */
  for (const [id, fn] of [['qolDockSide', 'qolDockSideChanged'], ['qolDockAutoHide', 'qolDockAutoHideChanged']]) {
    const tag = new RegExp('id="' + id + '"[^>]*onchange="([^"]*)"').exec(src)
      || new RegExp('onchange="([^"]*)"[^>]*id="' + id + '"').exec(src);
    ok(tag, shell + ': the ' + id + ' control lost its onchange handler');
    ok(tag[1].indexOf(fn + '(') === 0,
      shell + ': ' + id + ' calls ' + JSON.stringify(tag[1]) + ' rather than the guarded ' + fn +
      '() - a bare call throws ReferenceError whenever the owning script has not landed');
  }

  const code = lift(src, 'qolDockSideChanged', shell) + '\n' + lift(src, 'qolDockAutoHideChanged', shell);

  /* ---- 1. THE DEPENDENCY IS MISSING (deferred asset on the classic
     fallback, or the retire path having deleted it) ------------------------ */
  {
    const w = world({});
    vm.createContext(w.sandbox);
    vm.runInContext(code, w.sandbox, { filename: shell });
    let threw = null;
    try { w.sandbox.qolDockSideChanged('left'); } catch (e) { threw = e; }
    eq(threw, null, shell + ': changing the Navigation bar threw with the calm shell absent - ' +
      'that is the dead-and-silent control this guard exists to prevent (' + (threw && threw.message) + ')');
    eq(w.store['sf_u::qolDockSide'], 'left',
      shell + ': the choice was dropped rather than remembered - the calm shell reads this key when it loads');

    threw = null;
    try { w.sandbox.qolDockAutoHideChanged(true); } catch (e) { threw = e; }
    eq(threw, null, shell + ': the auto-hide checkbox threw with mls-connect absent (' + (threw && threw.message) + ')');
    eq(w.store['sf_u::qolDockAutoHide'], undefined,
      shell + ': auto-hide invented a storage key. That state belongs to mls-connect and guessing its ' +
      'key can disagree with the real one - the guard is meant to do nothing here, not something plausible');
  }

  /* ---- 2. ONLY A VALUE THE CONTROL ITSELF OFFERS EVER REACHES THE STORE -- */
  {
    const w = world({});
    vm.createContext(w.sandbox);
    vm.runInContext(code, w.sandbox, { filename: shell });
    w.sandbox.qolDockSideChanged('__injected__');
    eq(w.store['sf_u::qolDockSide'], undefined,
      shell + ': a value the select never offers was written to the dock preference');
    for (const side of ALLOWED_SIDES) {
      w.sandbox.qolDockSideChanged(side);
      eq(w.store['sf_u::qolDockSide'], side, shell + ': the offered value ' + side + ' was refused');
    }
  }

  /* ---- 3. NO SELECT IN THE DOM AT ALL - still no throw ------------------- */
  {
    const w = world({ noSelect: true });
    vm.createContext(w.sandbox);
    vm.runInContext(code, w.sandbox, { filename: shell });
    let threw = null;
    try { w.sandbox.qolDockSideChanged('top'); } catch (e) { threw = e; }
    eq(threw, null, shell + ': the handler threw when its own select was absent from the DOM');
    eq(w.store['sf_u::qolDockSide'], undefined,
      shell + ': with no select to validate against, a value was written anyway');
  }

  /* ---- 4. THE DEPENDENCY IS PRESENT - delegate, and do NOT double-write -- */
  {
    const w = world({ sideFn: true, autoFn: true });
    vm.createContext(w.sandbox);
    vm.runInContext(code, w.sandbox, { filename: shell });
    w.sandbox.qolDockSideChanged('right');
    w.sandbox.qolDockAutoHideChanged(false);
    assert.deepStrictEqual(w.calls, [['side', 'right'], ['auto', false]],
      shell + ': the guarded handlers did not delegate to the real implementations');
    checks++;
    eq(w.store['sf_u::qolDockSide'], undefined,
      shell + ': the fallback wrote the preference even though the real function was present, so two ' +
      'writers now own one key - the real one validates and applies, this one only remembers');
  }
}

console.log('PASS dock-settings-controls-never-throw: ' + checks +
  ' checks - across all four shells the Navigation bar select and the auto-hide checkbox delegate when their ' +
  'dynamically loaded owners are present, and when those owners are absent they neither throw nor drop the ' +
  "doctor's choice, while never writing a value the control does not itself offer");
