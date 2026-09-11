'use strict';

/* Owner 2026-09-11: in the op-note Templates modal, "Use templates when
 * generating" (useTemplates) and "Auto-choose the best-matching template by
 * keywords" (templateAuto) must be ON BY DEFAULT for a fresh account/device.
 * An account that already made an EXPLICIT choice - a stored '0' or '1',
 * whether typed by hand, toggled in the modal, or written by a seed/import
 * path - must keep exactly that choice; only a key that was NEVER written
 * changes behavior.
 *
 * This lifts the REAL useTemplatesOn()/templateAutoOn() reader functions out
 * of the shipped production shell (not a reimplementation) and runs them
 * against a fake localStorage, so a future edit that reverts the default (or
 * breaks the "explicit choice wins" half of the contract) fails here.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function liftReaders(source, label) {
  const start = source.indexOf('function useTemplatesOn(){');
  assert.ok(start >= 0, label + ': useTemplatesOn() not found');
  const end = source.indexOf('\nfunction getActiveTemplateId(){', start);
  assert.ok(end > start, label + ': could not find the end of templateAutoOn()');
  const slice = source.slice(start, end);
  assert.ok(slice.includes('function templateAutoOn(){'), label + ': templateAutoOn() not found in the sliced reader source');
  return slice;
}

function run(readerSource, initial) {
  const storage = new Map(Object.entries(initial || {}));
  const context = {
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    /* the real reader calls uns(name) to namespace the key per signed-in
     * account; the exact namespacing scheme is a different concern (uns()
     * itself), so a simple stand-in is used here - the SUBJECT under test is
     * the default-reading rule inside useTemplatesOn()/templateAutoOn(). */
    uns(suffix) { return 'sf_u::test-account::' + suffix; }
  };
  vm.createContext(context);
  vm.runInContext(readerSource, context, { filename: 'template-defaults-reader.js' });
  return context;
}

const USE_KEY = 'sf_u::test-account::useTemplates';
const AUTO_KEY = 'sf_u::test-account::templateAuto';

function checkAgainst(source, label) {
  const readerSource = liftReaders(source, label);

  /* 1. FRESH ACCOUNT/DEVICE: neither key has ever been written -> both ON. */
  {
    const ctx = run(readerSource, {});
    assert.strictEqual(ctx.useTemplatesOn(), true,
      label + ': a fresh account must default "Use templates when generating" to ON');
    assert.strictEqual(ctx.templateAutoOn(), true,
      label + ': a fresh account must default "Auto-choose the best-matching template" to ON');
  }

  /* 2. EXPLICIT OFF must stay OFF - a doctor who turned templates off is not
   *    silently re-enabled by this change. */
  {
    const ctx = run(readerSource, { [USE_KEY]: '0', [AUTO_KEY]: '0' });
    assert.strictEqual(ctx.useTemplatesOn(), false, label + ': an explicit OFF choice for useTemplates was overridden');
    assert.strictEqual(ctx.templateAutoOn(), false, label + ': an explicit OFF choice for templateAuto was overridden');
  }

  /* 3. EXPLICIT ON stays ON (pins the read path for the non-default branch too). */
  {
    const ctx = run(readerSource, { [USE_KEY]: '1', [AUTO_KEY]: '1' });
    assert.strictEqual(ctx.useTemplatesOn(), true, label + ': an explicit ON choice for useTemplates was lost');
    assert.strictEqual(ctx.templateAutoOn(), true, label + ': an explicit ON choice for templateAuto was lost');
  }

  /* 4. MIXED: one key explicit, the other never touched - each reads its OWN
   *    key independently, so a doctor who only ever toggled one checkbox does
   *    not have the other's default silently disturbed by that unrelated key. */
  {
    const ctx = run(readerSource, { [USE_KEY]: '0' });
    assert.strictEqual(ctx.useTemplatesOn(), false, label + ': explicit useTemplates=0 must still read OFF regardless of templateAuto');
    assert.strictEqual(ctx.templateAutoOn(), true, label + ': templateAuto must still default ON even though useTemplates was touched');
  }

  /* 5. Any other stored value (e.g. a stray non-'0'/'1' string) reads as OFF,
   *    same as the original '1'-equality check always did - only the
   *    null/never-set case is new. */
  {
    const ctx = run(readerSource, { [USE_KEY]: 'garbage' });
    assert.strictEqual(ctx.useTemplatesOn(), false, label + ': a non-null, non-"1" stored value must still read OFF');
  }
}

const production = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
checkAgainst(production, 'ScribeFlow.html');

/* the 1p source and its live twin must carry the identical reader - this is
 * plain default-reading logic, no route/marker concern, so it is not one of
 * the three hunks the 1p twins are allowed to differ by. */
for (const shell of ['1pScribeFlow.html', path.join('1p', 'index.html'), path.join('cloned', 'index.html')]) {
  const src = fs.readFileSync(path.join(root, shell), 'utf8');
  checkAgainst(src, shell);
}

console.log('PASS template defaults: useTemplatesOn()/templateAutoOn() default ON for a fresh account and respect every explicit choice, across ScribeFlow.html, 1pScribeFlow.html, 1p/index.html, and cloned/index.html');
