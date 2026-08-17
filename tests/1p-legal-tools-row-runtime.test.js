'use strict';

/* legal-tools-1.0.0 - the Legal / IME workspace row in the dock Tools menu.
 *
 * The Tools menu is built by the SHARED feat_mls_calm_shell.js, which this
 * lane may not edit. toolsSections() does not scan for opt-in rows: it walks a
 * hardcoded TOOLS_GROUPS spec list, resolving each spec by
 * document.getElementById(spec.id) or by a FIXED label regex inside a fixed
 * `within` container. This suite pins BOTH halves:
 *   1. that no shared spec can produce this row (which is why the /1p shells
 *      overlay it), and that the menu DOM contract the overlay depends on is
 *      still what the shared file builds;
 *   2. that the overlay, executed from the real shell source, puts exactly one
 *      correctly labelled row in the Practice group and that activating it
 *      opens the legal workspace root.
 * No network, no PHI, no real patient data. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const shared = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');
const legalpack = fs.readFileSync(path.join(root, '1p-feat_mls_legalpack.js'), 'utf8');

const START = '<!-- ===== legal-tools-1.0.0 =';
const END = '<!-- ===== end legal-tools-1.0.0 =';
const LABEL = 'Legal / IME workspace';
const ICON = '⚖️';

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ---------------------------------- 1. what the SHARED menu actually scans */
{
  const gStart = shared.indexOf('var TOOLS_GROUPS = [');
  const gEnd = shared.indexOf('var TOOLS_SOURCES', gStart);
  ok(gStart >= 0 && gEnd > gStart, 'TOOLS_GROUPS could not be located in feat_mls_calm_shell.js');
  const groups = shared.slice(gStart, gEnd);

  const resolveStart = shared.indexOf('function toolsResolve(spec)');
  const resolveEnd = shared.indexOf('function toolsItems()', resolveStart);
  ok(resolveStart >= 0 && resolveEnd > resolveStart, 'toolsResolve could not be located');
  const resolve = shared.slice(resolveStart, resolveEnd);
  ok(/D\.getElementById\(spec\.id\)/.test(resolve),
    'toolsResolve no longer resolves id specs through getElementById - re-check the overlay');
  ok(/qsa\('button,\.navtab', root\)/.test(resolve) && /spec\.label\.test\(textOf\(b\)\)/.test(resolve),
    'toolsResolve no longer resolves label specs by regex inside spec.within - re-check the overlay');

  /* Every label a shared spec can produce. If one of them ever becomes the
     Legal / IME workspace row, this overlay should be retired, and this
     assertion is what will say so. */
  const declared = (groups.match(/as:\s*'([^']+)'/g) || []).map(s => s.replace(/^as:\s*'/, '').replace(/'$/, ''));
  ok(declared.length > 0, 'no `as:` labels were found in TOOLS_GROUPS - the parser is wrong');
  eq(declared.indexOf(LABEL), -1,
    'a shared TOOLS_GROUPS spec now declares "' + LABEL + '" - the /1p overlay is redundant and must be retired');
  /* a regex literal: body may contain escaped slashes and character classes */
  const LITERAL = /label:\s*\/((?:\\.|\[[^\]]*\]|[^/\\])+)\/([a-z]*)/g;
  const matchers = [];
  let lit;
  while ((lit = LITERAL.exec(groups))) matchers.push(new RegExp(lit[1], lit[2]));
  ok(matchers.length > 0, 'no label regexes were found in TOOLS_GROUPS - the parser is wrong');
  eq(matchers.filter(re => re.test(LABEL)).length, 0,
    'a shared label regex now matches "' + LABEL + '" - the overlay would double the row');
  ok(/\{ id: 'nav_legalreq' \}/.test(groups),
    'the legacy nav_legalreq spec is gone from TOOLS_GROUPS - re-read the legal routing before trusting this suite');

  /* the exact menu DOM the overlay attaches to */
  const openStart = shared.indexOf('function openTools(anchorBtn)');
  const openEnd = shared.indexOf('function openCopilot()', openStart);
  ok(openStart >= 0 && openEnd > openStart, 'openTools could not be located');
  const openSrc = shared.slice(openStart, openEnd);
  ok(/menu\.id = 'mlsToolsMenu'/.test(openSrc), 'the Tools menu id changed - the overlay targets #mlsToolsMenu');
  ok(/<div class="grp" role="group" aria-label="' \+ s\.label \+ '"/.test(openSrc),
    'the Tools menu no longer groups rows as .grp[aria-label] - the overlay targets that');
  ok(/<div class="r" role="menuitem" tabindex="0"/.test(openSrc),
    'the Tools menu row shape changed - the overlay mirrors it');
  ok(/id: 'practice', label: 'Practice'/.test(groups), 'the Practice group the overlay targets is gone');

  /* THE CLOSE TRAP. openTools keeps a private toolsClose handle and its next
     call begins by toggling on it. A row that closes the menu by detaching the
     node leaves that handle set over a detached menu, and the doctor's next
     Tools press is swallowed. The overlay must therefore close through the
     shell's exported go(), and these two assertions are what will say so if
     either half of that contract moves. */
  ok(/if \(toolsClose\) \{ toolsClose\(\); return; \}/.test(openSrc),
    'openTools no longer toggles on a private toolsClose handle - re-check how the overlay closes the menu');
  ok(/if \(destId === 'tools'\) \{\s*openTools\(/.test(shared),
    "the shell's exported go('tools') no longer reaches openTools - the overlay closes through it");
  ok(/go: go,/.test(shared), 'the calm shell no longer exports go() - the overlay closes through it');
}

/* -------------------------------------- 2. the legal workspace root id */
const ROOT_ID = (/var ROOT_ID = '([^']+)'/.exec(legalpack) || [])[1];
eq(ROOT_ID, 'mlsP1LegalRoot', 'the legal workspace ROOT_ID moved - the overlay test asserts against it');
ok(/open: function \(\) \{ return apiCurrent\(\) \? openOverlay\(\) : false; \}/.test(legalpack),
  'the legal workspace no longer exposes open() as its public entry');

/* ---------------------------------------------------- 3. the overlay itself */
function liftBlock(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const a = src.indexOf(START);
  assert.ok(a >= 0, file + ': the legal-tools-1.0.0 block is missing');
  assert.ok(src.indexOf(START, a + 1) < 0, file + ': the legal-tools-1.0.0 block appears twice');
  const b = src.indexOf(END, a);
  assert.ok(b > a, file + ': the legal-tools-1.0.0 block is not closed');
  const chunk = src.slice(a, b);
  /* lane-neutral: the block must copy to another lane unchanged */
  for (const forbidden of ['__MLS_P1_PREVIEW', '1p-feat_', '1p-mls-connect', "'/1p'", '/1pScribeFlow']) {
    assert.ok(chunk.indexOf(forbidden) < 0, file + ': the block references ' + forbidden + ' - it is not lane-neutral');
  }
  const s = chunk.indexOf('<script>');
  const e = chunk.indexOf('</' + 'script>', s);
  assert.ok(s >= 0 && e > s, file + ': the block has no script');
  return chunk.slice(s + '<script>'.length, e);
}

/* ---- a small DOM, enough for the exact selectors the overlay uses ------- */
function makeDom() {
  let observer = null;
  /* A real MutationObserver drains on the microtask queue, so its callback is
     never re-entered from a mutation the callback itself makes. Model that,
     or the fixture invents a recursion the browser cannot produce. */
  let observerBusy = false;
  function notify() {
    if (!observer || observerBusy) return;
    observerBusy = true;
    try { observer(); } finally { observerBusy = false; }
  }
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), className: '', textContent: '',
      children: [], parentNode: null, attributes: Object.create(null), listeners: Object.create(null),
      appendChild(c) { c.parentNode = this; this.children.push(c); notify(); return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; notify(); return c; },
      setAttribute(k, v) { this.attributes[String(k)] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, String(k)) ? this.attributes[String(k)] : null; },
      removeAttribute(k) { delete this.attributes[String(k)]; },
      addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
      removeEventListener(n, fn) { const l = this.listeners[n] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      dispatch(n, ev) { (this.listeners[n] || []).slice().forEach(fn => fn(ev || { type: n, preventDefault() {}, stopPropagation() {} })); },
      descendants() { return this.children.reduce((all, c) => all.concat([c], c.descendants ? c.descendants() : []), []); },
      matches(sel) {
        if (sel.charAt(0) === '[') { const k = sel.slice(1, -1); return this.getAttribute(k) != null; }
        const m = /^\.([\w-]+)(?:\[aria-label="([^"]+)"\])?$/.exec(sel);
        if (!m) return false;
        if (String(this.className || '').split(/\s+/).indexOf(m[1]) < 0) return false;
        if (m[2] != null && this.getAttribute('aria-label') !== m[2]) return false;
        return true;
      },
      querySelector(sel) { return this.descendants().filter(d => d.matches && d.matches(sel))[0] || null; },
      querySelectorAll(sel) { return this.descendants().filter(d => d.matches && d.matches(sel)); }
    };
    return el;
  }
  const body = node('body');
  const doc = {
    readyState: 'complete', body, documentElement: body,
    createElement: t => node(t),
    getElementById(id) { return body.descendants().filter(d => d.getAttribute('id') === id)[0] || null; },
    querySelector: sel => body.querySelector(sel),
    listeners: Object.create(null),
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    removeEventListener() {}
  };
  return { doc, body, node, setObserver(fn) { observer = fn; } };
}

/* build the menu exactly as the shared openTools() does */
function renderToolsMenu(dom, groupLabels) {
  const menu = dom.node('div');
  menu.setAttribute('id', 'mlsToolsMenu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Tools');
  (groupLabels || ['During a visit', 'Practice', 'Data', 'App']).forEach(label => {
    const grp = dom.node('div');
    grp.className = 'grp';
    grp.setAttribute('role', 'group');
    grp.setAttribute('aria-label', label);
    const gh = dom.node('div'); gh.className = 'gh'; gh.setAttribute('aria-hidden', 'true'); gh.textContent = label;
    grp.appendChild(gh);
    const r = dom.node('div');
    r.className = 'r'; r.setAttribute('role', 'menuitem'); r.setAttribute('tabindex', '0'); r.setAttribute('data-i', '0');
    grp.appendChild(r);
    menu.appendChild(grp);
  });
  dom.body.appendChild(menu);
  return menu;
}

function boot(file, options) {
  options = options || {};
  const script = liftBlock(file);
  const dom = makeDom();
  const opened = [];
  const sandbox = {
    document: dom.doc, JSON, Date, Math, RegExp, String, Number, Array, Object, Boolean, Error,
    console: { warn() {}, log() {}, info() {}, error() {} },
    setTimeout(fn) { return fn(); }, clearTimeout() {},
    MutationObserver: function (cb) {
      this.observe = () => dom.setObserver(() => cb([]));
      this.disconnect = () => dom.setObserver(null);
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  /* the shared calm shell, standing in for the real one: go('tools') on an
     open menu is the toggle that runs its private close() */
  const shellGo = [];
  if (options.shell !== false) {
    sandbox.__mlsCalmShell = {
      version: 'calm-1.0.0',
      go(dest) {
        shellGo.push(String(dest));
        if (dest !== 'tools') return;
        const open = dom.doc.getElementById('mlsToolsMenu');
        if (open && open.parentNode) open.parentNode.removeChild(open);
      }
    };
  }
  if (options.workspace !== false) {
    sandbox.__mlsP1LegalPack = {
      installed: true,
      open() {
        opened.push(Date.now());
        if (!dom.doc.getElementById(ROOT_ID)) {
          const rootNode = dom.node('div');
          rootNode.setAttribute('id', ROOT_ID);
          dom.body.appendChild(rootNode);
        }
        return true;
      }
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: file + '#legal-tools-1.0.0' });
  return { sandbox, dom, opened, shellGo };
}

for (const file of SHELLS) {
  /* ---- the row appears in the Practice group of a freshly built menu ---- */
  const h = boot(file);
  const api = h.sandbox.window.__mlsLegalToolsRow;
  ok(api && api.version === 'legal-tools-1.0.0', file + ': the overlay did not install its api');
  eq(api.available(), true, file + ': the overlay reports the legal workspace unavailable');
  eq(api.present(), false, file + ': a row exists with no menu open');

  const menu = renderToolsMenu(h.dom);
  api.inject();
  eq(api.present(), true, file + ': the Legal row was not injected into the rendered Tools menu');
  const rows = menu.querySelectorAll('[data-mls-legal-tools]');
  eq(rows.length, 1, file + ': the Legal row was injected ' + rows.length + ' times');
  const row = rows[0];
  eq(row.getAttribute('role'), 'menuitem', file + ': the Legal row is not a menuitem');
  eq(row.getAttribute('tabindex'), '0', file + ': the Legal row is not keyboard reachable');
  eq(row.className, 'r', file + ': the Legal row does not carry the menu row class the shared menu styles');
  const nameCell = row.children.filter(c => c.className === 'rn')[0];
  const iconCell = row.children.filter(c => c.className === 'ri')[0];
  eq(nameCell && nameCell.textContent, LABEL, file + ': the Legal row label is wrong');
  eq(iconCell && iconCell.textContent, ICON, file + ': the Legal row icon is not the scales');
  eq(iconCell && iconCell.getAttribute('aria-hidden'), 'true', file + ': the icon is announced to screen readers');
  eq(row.parentNode.getAttribute('aria-label'), 'Practice', file + ': the Legal row did not land in the Practice group');

  /* re-running is idempotent - the observer fires on every body mutation */
  api.inject(); api.inject();
  eq(menu.querySelectorAll('[data-mls-legal-tools]').length, 1,
    file + ': repeated injection duplicated the Legal row');

  /* ---- clicking it closes the menu and opens the workspace root -------- */
  eq(h.dom.doc.getElementById(ROOT_ID), null, file + ': the workspace root existed before the row was clicked');
  row.dispatch('click', { type: 'click', preventDefault() {}, stopPropagation() {} });
  eq(h.opened.length, 1, file + ': clicking the Legal row did not open the legal workspace');
  ok(h.dom.doc.getElementById(ROOT_ID), file + ': clicking the Legal row did not create the workspace root ' + ROOT_ID);
  eq(h.dom.doc.getElementById('mlsToolsMenu'), null, file + ': the Tools menu stayed open behind the workspace');
  /* and it closed through the SHELL, so openTools' private toolsClose handle
     is released and the next Tools press is not swallowed */
  eq(h.shellGo.length, 1, file + ": the row did not close the menu through the shell's own go('tools') toggle");
  eq(h.shellGo[0], 'tools', file + ': the row closed by navigating somewhere other than the Tools toggle');

  /* ---- with no shell to toggle, it still must not leave the menu up ---- */
  const hNoShell = boot(file, { shell: false });
  renderToolsMenu(hNoShell.dom);
  hNoShell.sandbox.window.__mlsLegalToolsRow.inject();
  hNoShell.dom.doc.querySelector('[data-mls-legal-tools]')
    .dispatch('click', { type: 'click', preventDefault() {}, stopPropagation() {} });
  eq(hNoShell.dom.doc.getElementById('mlsToolsMenu'), null,
    file + ': with no calm shell present the Tools menu was left open behind the workspace');
  eq(hNoShell.opened.length, 1, file + ': the fallback close path skipped opening the workspace');

  /* ---- Enter activates it too ----------------------------------------- */
  const h2 = boot(file);
  renderToolsMenu(h2.dom);
  h2.sandbox.window.__mlsLegalToolsRow.inject();
  const row2 = h2.dom.doc.querySelector('[data-mls-legal-tools]');
  row2.dispatch('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  eq(h2.opened.length, 1, file + ': Enter on the Legal row did not open the workspace');

  /* ---- a rebuilt menu gets the row again ------------------------------ */
  const h3 = boot(file);
  renderToolsMenu(h3.dom);
  h3.sandbox.window.__mlsLegalToolsRow.inject();
  const firstMenu = h3.dom.doc.getElementById('mlsToolsMenu');
  h3.dom.body.removeChild(firstMenu);
  renderToolsMenu(h3.dom);
  h3.sandbox.window.__mlsLegalToolsRow.inject();
  eq(h3.sandbox.window.__mlsLegalToolsRow.present(), true,
    file + ': a rebuilt Tools menu lost the Legal row');

  /* ---- no workspace module, no row (never a control that does nothing) - */
  const h4 = boot(file, { workspace: false });
  renderToolsMenu(h4.dom);
  eq(h4.sandbox.window.__mlsLegalToolsRow.available(), false, file + ': the overlay claimed an absent workspace');
  eq(h4.sandbox.window.__mlsLegalToolsRow.inject(), false, file + ': a row was offered with no workspace behind it');
  eq(h4.sandbox.window.__mlsLegalToolsRow.present(), false, file + ': a dead Legal row was rendered');

  /* ---- a menu with no Practice group still gets a labelled group ------- */
  const h5 = boot(file);
  renderToolsMenu(h5.dom, ['During a visit', 'Data']);
  h5.sandbox.window.__mlsLegalToolsRow.inject();
  const row5 = h5.dom.doc.querySelector('[data-mls-legal-tools]');
  ok(row5, file + ': the Legal row was dropped when the Practice group was absent');
  eq(row5.parentNode.getAttribute('aria-label'), 'Practice',
    file + ': the fallback group is not labelled Practice');
  eq(row5.parentNode.getAttribute('role'), 'group', file + ': the fallback group is not a role=group');
}

/* ---- the two shells carry byte-identical blocks ------------------------ */
eq(liftBlock(SHELLS[0]), liftBlock(SHELLS[1]), 'the two /1p shells carry different legal-tools blocks');

console.log('PASS 1p-legal-tools-row: ' + checks + ' checks - no shared TOOLS_GROUPS spec can declare "' + LABEL +
  '" (so the row is overlaid, not declared), the shared menu DOM contract the overlay attaches to is unchanged, and in BOTH /1p shells the overlay renders exactly one keyboard-reachable Practice row that closes the menu and opens ' + ROOT_ID);
