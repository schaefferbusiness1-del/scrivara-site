'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.');
const compare = process.argv[3] ? path.resolve(process.argv[3]) : null;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const needed = new Set(['manifest.json']);
function add(value) {
  if (typeof value !== 'string' || !value || /^(?:[a-z]+:|\/|#)/i.test(value)) return;
  if (value.includes('*')) throw new Error('Expand manifest resource globs before staging');
  const clean = value.split(/[?#]/)[0];
  const full = path.resolve(root, clean);
  if (!full.startsWith(root + path.sep)) throw new Error('Reference outside extension');
  needed.add(clean);
}
function icons(value) { if (typeof value === 'string') add(value); else Object.values(value || {}).forEach(add); }
add(manifest.background?.service_worker);
(manifest.background?.scripts || []).forEach(add);
for (const c of manifest.content_scripts || []) [...(c.js || []), ...(c.css || [])].forEach(add);
for (const w of manifest.web_accessible_resources || []) (typeof w === 'string' ? [w] : w.resources || []).forEach(add);
icons(manifest.icons); icons(manifest.action?.default_icon); add(manifest.action?.default_popup);
add(manifest.options_page); add(manifest.options_ui?.page); add(manifest.devtools_page);
Object.values(manifest.chrome_url_overrides || {}).forEach(add);
const walked = new Set();
while (walked.size < needed.size) {
  for (const file of [...needed]) {
    if (walked.has(file)) continue;
    if (!fs.existsSync(path.join(root, file))) throw new Error('Missing manifest closure asset: ' + file);
    walked.add(file);
    if (!/\.(?:html|js)$/.test(file)) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    if (/\.html$/.test(file)) for (const m of text.matchAll(/(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) add(m[1]);
    if (/\.js$/.test(file)) {
      for (const m of text.matchAll(/['"]([^'"\s]+\.html)['"]/g)) add(m[1]);
      for (const m of text.matchAll(/importScripts\(([^)]+)\)/g)) for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) add(q[1]);
    }
  }
}
if (compare) {
  for (const file of needed) {
    const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (digest(path.join(root, file)) !== digest(path.join(compare, file))) throw new Error('Staged byte mismatch: ' + file);
  }
}
console.log(JSON.stringify({version:manifest.version,closureFiles:needed.size,complete:true,byteCompared:!!compare}));
