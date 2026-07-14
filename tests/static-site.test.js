'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const skipDirs = new Set(['.git', 'node_modules', 'tests']);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') && ent.name !== '.well-known') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!skipDirs.has(ent.name)) walk(full, out);
    } else out.push(full);
  }
  return out;
}

const files = walk(root);
const jsFiles = files.filter(f => f.endsWith('.js'));
const jsonFiles = files.filter(f => /\.(?:json|webmanifest)$/i.test(f));
const htmlFiles = files.filter(f => f.endsWith('.html'));

const syntaxErrors = [];
for (const file of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) syntaxErrors.push(`${path.relative(root, file)}: ${(r.stderr || r.stdout || '').trim()}`);
}
assert.deepStrictEqual(syntaxErrors, [], `JavaScript syntax errors:\n${syntaxErrors.join('\n')}`);

const jsonErrors = [];
for (const file of jsonFiles) {
  try { JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { jsonErrors.push(`${path.relative(root, file)}: ${e.message}`); }
}
assert.deepStrictEqual(jsonErrors, [], `JSON parse errors:\n${jsonErrors.join('\n')}`);

let inlineCount = 0;
const inlineErrors = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    const typeMatch = m[1].match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (typeMatch && !/^(?:text|application)\/(?:java|ecma)script$|^module$/i.test(typeMatch[1].trim())) continue;
    const code = m[2].replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
    if (!code.trim()) continue;
    inlineCount++;
    try { Function(code); }
    catch (e) { inlineErrors.push(`${path.relative(root, file)} inline script ${inlineCount}: ${e.message}`); }
  }
}
assert.deepStrictEqual(inlineErrors, [], `Inline script syntax errors:\n${inlineErrors.join('\n')}`);

const missingAssets = [];
const seenAssetChecks = new Set();
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw || /^(?:https?:|data:|mailto:|tel:|javascript:|#|\/\/)/i.test(raw) || /\{\{|\$\{|\+/.test(raw)) continue;
    const clean = raw.split(/[?#]/)[0].replace(/^\.\//, '');
    if (!/\.(?:js|css|html?|png|jpe?g|gif|svg|ico|json|webmanifest)$/i.test(clean)) continue;
    const target = raw.startsWith('/')
      ? path.resolve(root, clean.replace(/^\/+/, ''))
      : path.resolve(path.dirname(file), clean);
    const key = `${file}\0${target}`;
    if (seenAssetChecks.has(key)) continue;
    seenAssetChecks.add(key);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) missingAssets.push(`${path.relative(root, file)} -> ${raw}`);
  }
}
assert.deepStrictEqual(missingAssets, [], `Missing local HTML assets:\n${missingAssets.join('\n')}`);

const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const loaderNames = [];
for (const m of connect.matchAll(/data-mls-asset=["']([^"']+)["']/g)) {
  if (/^[A-Za-z0-9._-]+\.js$/.test(m[1])) loaderNames.push(m[1]);
}
const missingLoaders = Array.from(new Set(loaderNames)).filter(name => !fs.existsSync(path.join(root, name)));
assert.deepStrictEqual(missingLoaders, [], `Missing dynamic enhancement scripts: ${missingLoaders.join(', ')}`);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'extension manifest version must be x.y.z');
for (const icon of Object.values(manifest.icons || {})) assert(fs.existsSync(path.join(root, icon)), `missing manifest icon: ${icon}`);

console.log(`PASS static site: ${jsFiles.length} JS, ${jsonFiles.length} JSON, ${inlineCount} inline scripts, ${seenAssetChecks.size} local asset references`);
