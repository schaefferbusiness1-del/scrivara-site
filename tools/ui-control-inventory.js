'use strict';

/* UI control inventory — slice S0 of UI_CHARTER_CALM_SHELL_2026-07-24.md.
 *
 * Walks ScribeFlow.html and every feat_*.js module and records EVERY control a
 * doctor can reach: buttons, nav tabs, and any element carrying an inline
 * handler. The result is the receipt behind the owner's binding constraint —
 * "ease of use without losing any features". The Calm Shell relocates controls;
 * this manifest is how we prove none of them fell on the floor.
 *
 * Emits tests/fixtures/ui-control-manifest.json. Regenerate with:
 *   node tools/ui-control-inventory.js
 * The coverage suite regenerates in memory and fails if the committed manifest
 * is stale, so it can never drift quietly.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_HTML = 'ScribeFlow.html';
const MANIFEST_PATH = path.join(ROOT, 'tests', 'fixtures', 'ui-control-manifest.json');

function sourceFiles() {
  const files = [APP_HTML];
  for (const name of fs.readdirSync(ROOT)) {
    if (/^feat_.*\.js$/.test(name)) files.push(name);
  }
  return files;
}

/* Labels arrive full of emoji, entities, nested markup and JS string
 * concatenation ('+ptName+'). Normalize hard so a doctor typing the words they
 * see in Ask matches the same control the manifest recorded. */
function cleanLabel(raw) {
  let s = String(raw || '');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/\\'/g, "'").replace(/\\"/g, '"');
  s = s.replace(/'\s*\+[^+]*\+\s*'/g, ' ');
  s = s.replace(/\$\{[^}]*\}/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  s = s.replace(/[\u2190-\u2BFF\u2600-\u27BF\uFE0F\u200D]/g, ' ');
  s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ');
  s = s.replace(/[\uFF0B\u3010\u3011]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, 120);
}

function attr(attrs, name) {
  const m = new RegExp(name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i').exec(attrs);
  return m ? m[2] : '';
}

function hasBareAttr(attrs, name) {
  return new RegExp('(^|\\s)' + name + '(\\s|=|$)', 'i').test(attrs);
}

/* Gated = deliberately not offered in this build (feature flag, unreleased
 * lane, role gate). Gated controls stay in the manifest so a later ungating
 * cannot slip a control into the app with nowhere to reach it from — but they
 * are exempt from the reach requirement while gated. */
function isGated(attrs) {
  if (hasBareAttr(attrs, 'hidden')) return true;
  if (hasBareAttr(attrs, 'disabled')) return true;
  if (/aria-hidden\s*=\s*(["'])true\1/i.test(attrs)) return true;
  const style = attr(attrs, 'style');
  if (/display\s*:\s*none/i.test(style)) return true;
  return false;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/* Line numbers are needed for a few thousand offsets in a 1.9 MB file; walking
 * from zero each time is quadratic. Precompute newline offsets once per file. */
function lineIndexer(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return function (index) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/* Which container does this offset sit in?
 *
 * Nearest-preceding-marker attribution is WRONG here: #intakeView opens at 1511
 * and closes long before the header at 1717, so every chrome control would be
 * filed under a modal it has nothing to do with. The coverage suite exists to
 * catch chrome controls losing their home, so attribution has to be structural.
 *
 * Real containment, with two rules that keep it honest on a 1.9 MB file:
 *  - <script>/<style> bodies are skipped for nesting (they are full of HTML in
 *    JS strings that would corrupt any tag stack) and marked 'dynamic', which
 *    is what module-built controls are anyway.
 *  - void and self-closing tags never push. */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polygon',
  'polyline', 'ellipse', 'use', 'stop', 'image']);

function containerIndexer(text) {
  const spans = [];
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(text))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/';

    if (!closing && (tag === 'script' || tag === 'style') && !selfClose) {
      const endRe = new RegExp('<\\/' + tag + '\\s*>', 'gi');
      endRe.lastIndex = tagRe.lastIndex;
      const end = endRe.exec(text);
      const stop = end ? end.index + end[0].length : text.length;
      if (tag === 'script') spans.push({ name: 'dynamic', start: m.index, end: stop });
      tagRe.lastIndex = stop;
      continue;
    }
    if (VOID_TAGS.has(tag) || selfClose) continue;

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          const open = stack[i];
          if (open.name) spans.push({ name: open.name, start: open.start, end: tagRe.lastIndex });
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const id = attr(attrs, 'id');
    const cls = attr(attrs, 'class');
    let name = '';
    if (/View$/.test(id)) name = id;
    else if (id === 'appHeader') name = 'chrome:header';
    else if (/(^|\s)mainnav(\s|$)/.test(cls)) name = 'chrome:rail';
    else if (id === 'patientBar') name = 'chrome:patientbar';
    else if (id === 'authScreen' || id === 'agGateScreen') name = 'auth';
    stack.push({ tag: tag, name: name, start: m.index });
  }

  /* Innermost wins: shortest span containing the offset. */
  return function (index) {
    let best = null;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      if (s.start <= index && index < s.end) {
        if (!best || (s.end - s.start) < (best.end - best.start)) best = s;
      }
    }
    return best ? best.name : 'global';
  };
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function collect(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lineAt = lineIndexer(text);
  const viewAt = file === APP_HTML ? containerIndexer(text) : function () { return 'dynamic'; };
  const out = [];
  const seen = new Set();

  function push(rec) {
    const key = rec.file + ':' + rec.line + ':' + rec.kind + ':' + (rec.domId || rec.label);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rec);
  }

  function record(kind, tag, attrs, label, index) {
    const domId = attr(attrs, 'id');
    const title = attr(attrs, 'title');
    const aria = attr(attrs, 'aria-label');
    const text_ = cleanLabel(label) || cleanLabel(aria) || cleanLabel(title) || domId;
    if (!text_) return;
    const line = lineAt(index);
    push({
      id: domId || (slug(file) + '-' + line + '-' + (slug(text_) || kind)),
      label: text_,
      title: cleanLabel(title),
      kind: kind,
      tag: tag.toLowerCase(),
      domId: domId || null,
      view: viewAt(index),
      file: file,
      line: line,
      gated: isGated(attrs),
      handler: cleanLabel(attr(attrs, 'onclick')).slice(0, 80) || null
    });
  }

  /* Buttons — declared in HTML and built inside module template strings. */
  const btn = /<button\b([^>]*)>([\s\S]{0,300}?)<\/button>/gi;
  let m;
  while ((m = btn.exec(text))) record('button', 'button', m[1], m[2], m.index);

  /* Nav tabs — today's rail. The shell hides these, so every one of them must
   * gain a dock or tools reach path or the coverage suite fails. */
  const nav = /<(div|a|li|span)\b([^>]*class\s*=\s*(["'])[^"']*navtab[^"']*\3[^>]*)>([\s\S]{0,300}?)<\/\1>/gi;
  while ((m = nav.exec(text))) record('navtab', m[1], m[2], m[4], m.index);

  /* Anything else wired with an inline handler: menu rows, chips, links. */
  const clickable = /<(a|div|span|li|td|tr|img|label)\b([^>]*\bonclick\s*=[^>]*)>([\s\S]{0,200}?)<\/\1>/gi;
  while ((m = clickable.exec(text))) {
    if (/class\s*=\s*(["'])[^"']*navtab/i.test(m[2])) continue;
    record('handler', m[1], m[2], m[3], m.index);
  }

  return out;
}

function build() {
  const files = sourceFiles();
  let controls = [];
  for (const file of files) controls = controls.concat(collect(file));

  controls.sort(function (a, b) {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });

  const byKind = {};
  const byView = {};
  for (const c of controls) {
    byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    byView[c.view] = (byView[c.view] || 0) + 1;
  }

  return {
    generatedBy: 'tools/ui-control-inventory.js',
    charter: 'UI_CHARTER_CALM_SHELL_2026-07-24.md',
    sources: files.length,
    totals: {
      controls: controls.length,
      gated: controls.filter(function (c) { return c.gated; }).length,
      active: controls.filter(function (c) { return !c.gated; }).length,
      byKind: byKind
    },
    views: byView,
    controls: controls
  };
}

if (require.main === module) {
  const manifest = build();
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1) + '\n', 'utf8');
  console.log('ui-control-inventory: ' + manifest.totals.controls + ' controls (' +
    manifest.totals.active + ' active, ' + manifest.totals.gated + ' gated) from ' +
    manifest.sources + ' sources -> tests/fixtures/ui-control-manifest.json');
}

module.exports = { build: build, cleanLabel: cleanLabel, MANIFEST_PATH: MANIFEST_PATH };
