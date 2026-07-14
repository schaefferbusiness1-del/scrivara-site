const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extensionPages = new Set(['offscreen.html', 'popup.html']);
const pages = fs.readdirSync(root).filter(name => name.endsWith('.html') && !extensionPages.has(name));
const browserBuiltins = new Set(['alert', 'confirm', 'prompt', 'open', 'print', 'scrollTo', 'setTimeout', 'setInterval']);
const failures = [];
let handlerCount = 0;

function pageCode(name, html) {
  let code = html;
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi)) {
    const raw = match[2].split(/[?#]/)[0];
    if (!raw || /^(?:https?:|\/\/)/i.test(raw)) continue;
    const file = path.resolve(root, raw.replace(/^\.\//, ''));
    if (file.startsWith(root + path.sep) && fs.existsSync(file)) code += '\n' + fs.readFileSync(file, 'utf8');
  }
  return code;
}

function isDefined(code, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    `function\\s+${escaped}\\s*\\(`,
    `(?:var|let|const)\\s+${escaped}\\s*=`,
    `(?:window|globalThis|W)\\s*\\.\\s*${escaped}\\s*=`,
    `(?:window|globalThis|W)\\s*\\[\\s*["']${escaped}["']\\s*\\]\\s*=`,
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
