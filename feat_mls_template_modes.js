/* MLS Scribe /p1 template-mode labels.
 *
 * Presentation-only adapter for the existing operative-note template engine.
 * The established values remain strict/adapt/guide and the established
 * storage, generation, fidelity, template-library and cloud paths are never
 * wrapped or replaced. This file only gives those three modes the shorter P1
 * labels requested by the product owner:
 *
 *   strict -> Closely
 *   adapt  -> Balanced
 *   guide  -> Adapt to case
 *
 * Exact P1 loader ownership is required. Revert restores every text/title
 * mutation still owned by this adapter.
 */
;(function () {
  'use strict';

  var VERSION = 'p1-template-modes-1.0.0';
  var ASSET = 'feat_mls_template_modes.js';
  var LOADER_KEY = '__mlsP1TemplateModesLoader';
  var API_KEY = '__mlsP1TemplateModes';
  var script = document.currentScript;
  var loader = window[LOADER_KEY];
  var installToken = script && String(script.getAttribute('data-mls-install-token') || '');
  var preview = window.__MLS_MAIN;

  if (!preview || preview.enabled !== true || !script || !loader ||
      loader.installed !== true || loader.version !== VERSION ||
      !installToken || loader.installToken !== installToken ||
      script.getAttribute('data-mls-asset') !== ASSET ||
      script.getAttribute('data-mls-version') !== VERSION) return;

  var prior = window[API_KEY];
  if (prior && prior.installed === true) {
    if (prior.version === VERSION && prior.installToken === installToken &&
        typeof prior.reconcile === 'function' && typeof prior.revert === 'function' &&
        typeof prior.labelFor === 'function') {
      try { prior.reconcile(); } catch (_sameOwnerError) {}
      return;
    }
    if (typeof prior.revert !== 'function') return;
    try { if (prior.revert() !== true) return; } catch (_priorError) { return; }
    if (window[API_KEY] && window[API_KEY].installed === true) return;
  }

  var LABELS = { strict: 'Closely', adapt: 'Balanced', guide: 'Adapt to case' };
  var DETAILS = {
    strict: 'Keeps your wording. Fills only what varies.',
    adapt: 'Keeps your structure, adapts the wording. Recommended.',
    guide: 'Keeps your headings, writes tighter prose in its own words.'
  };
  var LEGACY_TO_MODE = {
    'follow it closely': 'strict',
    'adapt to the case': 'adapt',
    'use it as a guide — concise': 'guide',
    'use it as a guide - concise': 'guide',
    'closely': 'strict',
    'balanced': 'adapt',
    'adapt to case': 'guide',
    'strict': 'strict',
    'adapt': 'adapt',
    'guide': 'guide'
  };
  var records = [];
  var observer = null;
  var scheduled = false;
  var installed = true;
  var api = null;
  var listeners = [];

  function safe(fn, fallback) { try { return fn(); } catch (_error) { return fallback; } }
  function ownLoader() {
    var live = window[LOADER_KEY];
    return !!(live && live.installed === true && live.version === VERSION &&
      live.installToken === installToken);
  }
  function ownApi() {
    return !!(installed && api && window[API_KEY] === api && api.installed === true &&
      api.version === VERSION && api.installToken === installToken);
  }
  function live() {
    var p1 = window.__MLS_MAIN;
    return !!(p1 && p1.enabled === true && ownLoader() && ownApi());
  }
  function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function labelFor(mode) { mode = clean(mode).toLowerCase(); return LABELS[mode] || ''; }
  function directTextNode(element) {
    if (!element || !element.childNodes) return null;
    for (var i = 0; i < element.childNodes.length; i++) {
      if (element.childNodes[i] && element.childNodes[i].nodeType === 3) return element.childNodes[i];
    }
    return null;
  }
  function textRecord(node) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].kind === 'text' && records[i].node === node) return records[i];
    }
    return null;
  }
  function attrRecord(element, name) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].kind === 'attr' && records[i].element === element && records[i].name === name) return records[i];
    }
    return null;
  }
  function setDirectText(element, value) {
    if (!element) return;
    var node = directTextNode(element), record;
    if (!node) {
      node = document.createTextNode(value);
      element.insertBefore(node, element.firstChild || null);
      records.push({ kind: 'text', node: node, original: '', inserted: true, adapted: value });
      return;
    }
    record = textRecord(node);
    if (!record) {
      record = { kind: 'text', node: node, original: node.nodeValue, inserted: false, adapted: value };
      records.push(record);
    } else if (node.nodeValue !== record.adapted && node.nodeValue !== value) {
      /* A live base render reused the node. Keep its newest base value so an
         eventual revert never resurrects stale presentation. */
      record.original = node.nodeValue;
    }
    record.adapted = value;
    if (node.nodeValue !== value) node.nodeValue = value;
  }
  function setAttr(element, name, value) {
    if (!element || !element.getAttribute || !element.setAttribute) return;
    var record = attrRecord(element, name), current = element.getAttribute(name);
    if (!record) {
      record = { kind: 'attr', element: element, name: name,
        had: element.hasAttribute(name), original: current, adapted: value };
      records.push(record);
    } else if (current !== record.adapted && current !== value) {
      record.had = element.hasAttribute(name);
      record.original = current;
    }
    record.adapted = value;
    if (current !== value) element.setAttribute(name, value);
  }
  function modeOf(value) { return LEGACY_TO_MODE[clean(value).toLowerCase()] || ''; }
  function relabelModeButton(button) {
    var mode = clean(button && button.getAttribute && button.getAttribute('data-tplmode')).toLowerCase();
    var label = labelFor(mode);
    if (!label || !button) return;
    var name = safe(function () { return button.querySelector('.nm'); }, null) || button;
    setDirectText(name, label);
    /* THE SHELL OWNS NATIVE TOOLTIPS, so this must not write one.
       1pScribeFlow's _stripOneTitle converts EVERY title into data-tip and
       removes the title, driven by a document-wide MutationObserver, so that
       the browser's native tooltip never stacks on top of the app's own. A
       title written here is therefore removed again within the same frame,
       and because setAttr() re-reads getAttribute('title') - which is now
       null - the next reconcile writes it back. That is a ping-pong, not a
       label.

       MEASURED on the op-note rail, ten opPrepRender() calls, three mode
       buttons: 57 setAttribute('title') from here and 57
       removeAttribute('title') from _stripOneTitle, with no user action and
       nothing about the buttons changing. It is the dominant half of the
       .opr-tplmode churn the opnotes4 lane reported.

       So follow the tooltip rather than fight for it. While a native title is
       still on the button - which is the case on a bare page, and for the one
       frame after the room rebuilds the rail - keep it in step. Once the
       shell has taken it away, data-tip is the live copy and THAT is what is
       kept current; setAttr's own equality check then makes every later
       reconcile a no-op. The doctor sees the same text either way, through
       the same renderer. */
    var tip = label + ' — ' + DETAILS[mode];
    var hasTitle = safe(function () { return button.hasAttribute('title'); }, false);
    var hasTip = safe(function () { return button.hasAttribute('data-tip'); }, false);
    if (hasTitle) setAttr(button, 'title', tip);
    if (hasTip || !hasTitle) setAttr(button, 'data-tip', tip);
  }
  function relabelRedoButton(button) {
    var mode = clean(button && button.getAttribute && button.getAttribute('data-oprredo')).toLowerCase();
    var label = labelFor(mode);
    if (!label || !button) return;
    setDirectText(button, 'Re-draft: ' + label);
  }
  function relabelUsedStyle(labelNode) {
    var node = directTextNode(labelNode);
    var mode = modeOf(node ? node.nodeValue : labelNode && labelNode.textContent);
    var label = labelFor(mode);
    if (label) setDirectText(labelNode, label);
  }
  function all(selector) {
    return safe(function () { return document.querySelectorAll(selector); }, []);
  }
  function reconcile() {
    scheduled = false;
    if (!ownApi()) return false;
    if (!live()) { revert(); return false; }
    var nodes = all('#oprTplMode [data-tplmode]'), i;
    for (i = 0; i < nodes.length; i++) relabelModeButton(nodes[i]);
    nodes = all('#oprReceipt [data-oprredo]');
    for (i = 0; i < nodes.length; i++) relabelRedoButton(nodes[i]);
    nodes = all('#oprReceipt .opr-usedstyle > b');
    for (i = 0; i < nodes.length; i++) relabelUsedStyle(nodes[i]);
    if (records.length > 192) records = records.filter(function (record) {
      var node = record.kind === 'text' ? record.node : record.element;
      return !!(node && (typeof node.isConnected !== 'boolean' || node.isConnected));
    });
    return true;
  }
  function schedule() {
    if (!live() || scheduled) return;
    scheduled = true;
    Promise.resolve().then(function () { if (scheduled) reconcile(); });
  }
  function on(target, name, handler) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(name, handler, true);
    listeners.push([target, name, handler]);
  }
  function boundary() {
    /* Labels contain no account facts. A session transition merely discards
       detached-node bookkeeping and reconciles the newly rendered room. */
    records = records.filter(function (record) {
      var node = record.kind === 'text' ? record.node : record.element;
      return !!(node && (typeof node.isConnected !== 'boolean' || node.isConnected));
    });
    schedule();
  }
  function restoreRecord(record) {
    if (!record) return;
    if (record.kind === 'text') {
      var node = record.node;
      if (!node || node.nodeValue !== record.adapted) return;
      if (record.inserted) {
        if (node.parentNode) node.parentNode.removeChild(node);
      } else node.nodeValue = record.original;
      return;
    }
    if (record.kind === 'attr') {
      var element = record.element;
      if (!element || !element.getAttribute || element.getAttribute(record.name) !== record.adapted) return;
      if (record.had) element.setAttribute(record.name, record.original == null ? '' : record.original);
      else element.removeAttribute(record.name);
    }
  }
  function revert() {
    if (!ownApi()) return false;
    installed = false;
    scheduled = false;
    if (observer) { safe(function () { observer.disconnect(); }); observer = null; }
    for (var i = 0; i < listeners.length; i++) {
      safe((function (entry) { return function () { entry[0].removeEventListener(entry[1], entry[2], true); }; })(listeners[i]));
    }
    listeners = [];
    for (i = records.length - 1; i >= 0; i--) safe((function (record) { return function () { restoreRecord(record); }; })(records[i]));
    records = [];
    api.installed = false;
    if (window[API_KEY] === api) {
      try { delete window[API_KEY]; } catch (_deleteError) { window[API_KEY] = null; }
    }
    return true;
  }

  api = {
    installed: true,
    version: VERSION,
    installToken: installToken,
    labelFor: labelFor,
    reconcile: reconcile,
    revert: revert
  };
  window[API_KEY] = api;

  on(window, 'mls:session-boundary', boundary);
  on(window, 'mls:account-changed', boundary);
  on(window, 'mls:session-changed', boundary);
  if (typeof window.MutationObserver === 'function' && document.documentElement) {
    observer = new window.MutationObserver(function () {
      if (!ownApi()) return;
      if (!window.__MLS_MAIN || window.__MLS_MAIN.enabled !== true || !ownLoader()) {
        revert(); return;
      }
      schedule();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tplmode', 'data-oprredo', 'id', 'class']
    });
  }
  reconcile();
})();
