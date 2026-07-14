const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extensionPages = new Set(['offscreen.html', 'popup.html']);
const htmlFiles = fs.readdirSync(root).filter(name => name.toLowerCase().endsWith('.html') && !extensionPages.has(name));
const pages = new Map(htmlFiles.map(name => [name.toLowerCase(), fs.readFileSync(path.join(root, name), 'utf8')]));
const failures = [];

function attr(attrs, name) {
  const match = attrs.match(new RegExp('\\b' + name + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i'));
  return match ? match[2].replace(/&amp;/g, '&') : '';
}

function hasAnchor(html, fragment) {
  const decoded = decodeURIComponent(fragment);
  const escaped = decoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b(?:id|name)\\s*=\\s*(["\\\'])' + escaped + '\\1', 'i').test(html);
}

for (const [name, html] of pages) {
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = match[1];
    const raw = attr(attrs, 'href').trim();
    if (!raw || /^(?:https?:|mailto:|tel:|javascript:|data:|\/\/)/i.test(raw)) continue;

    if (raw === '#') {
      if (!/\bonclick\s*=|\bdata-[\w-]+\s*=|\bid\s*=/i.test(attrs)) failures.push(`${name}: inert href="#" link without a handler hook`);
      continue;
    }

    const [targetPart, fragment] = raw.split('#', 2);
    if (!fragment) continue;
    const targetName = (targetPart || name).split(/[?]/)[0].replace(/^\.\//, '').toLowerCase();
    const targetHtml = pages.get(targetName);
    if (!targetHtml) continue;
    if (!hasAnchor(targetHtml, fragment)) failures.push(`${name}: ${raw} points to a missing anchor`);
  }
}

assert.deepStrictEqual(failures, [], `Broken local navigation targets:\n${failures.join('\n')}`);
console.log(`PASS local navigation contract: ${pages.size} HTML pages have valid local fragment targets and no unhooked dead links`);
