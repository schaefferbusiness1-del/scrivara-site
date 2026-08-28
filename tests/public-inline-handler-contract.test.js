const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extensionPages = new Set(['offscreen.html', 'popup.html']);
/* inlinescope-1.0.0 (2026-08-28): SCAN THE SUBDIRECTORY SHELLS TOO.
   This listed only root-level HTML, so /1p/index.html and /cloned/index.html -
   both SERVED, and both carrying the same thousands of inline handlers as the
   production shell - were never checked. A dead control introduced there was
   invisible to the one contract whose job is to find dead controls.
   Measured when this was widened: 58 pages, 3,662 inline handlers, ZERO
   unresolved - so nothing was hiding there today. The point is that a future
   one cannot hide either. */
const pages = (function collect(dir, depth) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'tests' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    if (st.isDirectory()) { if (depth < 2) out.push(...collect(full, depth + 1)); continue; }
    if (name.endsWith('.html') && !extensionPages.has(name)) out.push(path.relative(root, full).replace(/\\/g, '/'));
  }
  return out;
})(root, 0);
assert.ok(pages.includes('1p/index.html') && pages.includes('cloned/index.html'),
  'the served subdirectory shells are not being scanned - a dead control in /1p or /cloned would be ' +
  'invisible to the contract whose entire job is to find dead controls');
const browserBuiltins = new Set(['alert', 'confirm', 'prompt', 'open', 'print', 'scrollTo', 'setTimeout', 'setInterval']);
const failures = [];
let handlerCount = 0;

function pageCode(name, html) {
  let code = html;
  /* inlinescope-1.0.0: a page in a subdirectory resolves a RELATIVE src against
     its own directory and an ABSOLUTE one against the site root. Resolving
     everything against the root - as this did - silently fails to find the
     scripts of any page that is not at the root, which would make every one of
     its handlers look unresolved. */
  const pageDir = path.dirname(path.resolve(root, name));
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi)) {
    const raw = match[2].split(/[?#]/)[0];
    if (!raw || /^(?:https?:|\/\/)/i.test(raw)) continue;
    const file = raw.startsWith('/')
      ? path.resolve(root, raw.slice(1))
      : path.resolve(pageDir, raw.replace(/^\.\//, ''));
    if (file.startsWith(root + path.sep) && fs.existsSync(file)) code += '\n' + fs.readFileSync(file, 'utf8');
  }
  return code;
}

/* inlinedef-1.0.0 (2026-08-28): an assignment is `=` NOT followed by `=`.
   These patterns ended in a bare `=`, so a COMPARISON counted as a definition:
   `if (typeof window.applyDockSidePreview === 'function')` satisfied the
   window-property pattern and this suite reported the handler resolved. It did
   not. Neither applyDockSidePreview nor applyDockAutoHidePreview is defined in
   any statically linked script - they arrive with feat_mls_calm_shell.js and
   mls-connect.js, both loaded dynamically - so both inline handlers threw
   ReferenceError whenever those had not landed, while this contract stayed
   green on the strength of the guards that were there BECAUSE the functions are
   unreliable. A test that reads a defensive typeof check as proof of definition
   is measuring the symptom as the cure.
   Measured across all 2,436 scanned handlers, exactly two depended on the loose
   form; both are fixed in this same change, so tightening costs no coverage. */
function isDefined(code, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assign = '=(?!=)';
  const patterns = [
    `function\\s+${escaped}\\s*\\(`,
    `(?:var|let|const)\\s+${escaped}\\s*${assign}`,
    `(?:window|globalThis|W)\\s*\\.\\s*${escaped}\\s*${assign}`,
    `(?:window|globalThis|W)\\s*\\[\\s*["']${escaped}["']\\s*\\]\\s*${assign}`,
    `${escaped}\\s*:\\s*(?:function|\\([^)]*\\)\\s*=>)`
  ];
  return patterns.some(pattern => new RegExp(pattern).test(code));
}

for (const name of pages) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const code = pageCode(name, html);
  for (const match of html.matchAll(/\b(?:onclick|onchange|onsubmit)\s*=\s*(["'])(.*?)\1/gi)) {
    handlerCount++;
    const expression = match[2].trim();
    const firstCall = expression.match(/^(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    if (!firstCall) continue;
    const handler = firstCall[1];
    if (browserBuiltins.has(handler) || isDefined(code, handler)) continue;
    failures.push(`${name}: ${match[0]} calls missing ${handler}()`);
  }
}

assert.deepStrictEqual(failures, [], `Unresolved inline control handlers:\n${failures.join('\n')}`);
console.log(`PASS public inline-handler contract: ${handlerCount} non-extension control handlers resolve to page or linked-script functions`);
