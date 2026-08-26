'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const connect = read('mls-connect.js');

function between(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert(start >= 0 && end > start, `could not isolate ${label}`);
  return source.slice(start, end);
}

const gateSource = between(
  connect,
  '/* A hot bundle refresh is allowed to reload this tab only when the clinical',
  '/* Same-document asset refreshes cannot replace the inline speech coordinator',
  'safe upgrade gate'
);
const speechSource = between(
  connect,
  '/* Same-document asset refreshes cannot replace the inline speech coordinator',
  '/* The production candidate has one canonical Easy UI.',
  'speech hub upgrade policy'
);
const easyBody = between(
  connect,
  "var VER = '3.7.3'",
  '/* ---------------- canonical install policy',
  'Easy upgrade prelude'
);
const easyPrelude = `;(function () { 'use strict';\n${easyBody}\n})();`;

function makeNode(tag, nodes) {
  const kids = [];
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '', value: '', textContent: '', style: {}, parentNode: null,
    isContentEditable: false,
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    dispatch(type) { (listeners[type] || []).slice().forEach(fn => fn({ target: node })); },
    appendChild(child) {
      kids.push(child); child.parentNode = node;
      if (child.id) nodes[child.id] = child;
      return child;
    },
    removeChild(child) {
      const at = kids.indexOf(child); if (at >= 0) kids.splice(at, 1);
      if (child.id && nodes[child.id] === child) delete nodes[child.id];
      child.parentNode = null; return child;
    },
    remove() {
      if (node.parentNode) node.parentNode.removeChild(node);
      else if (node.id && nodes[node.id] === node) delete nodes[node.id];
    }
  };
  Object.defineProperty(node, 'firstChild', { get() { return kids[0] || null; } });
  return node;
}

function makeUpgradeContext(initialStore) {
  const nodes = {};
  const store = new Map(initialStore ? Array.from(initialStore.entries()) : []);
  const body = makeNode('body', nodes);
  const head = makeNode('head', nodes);
  const document = {
    body, head, documentElement: makeNode('html', nodes), activeElement: body,
    readyState: 'complete',
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) { return makeNode(tag, nodes); },
    addEventListener() {}
  };
  let reloads = 0;
  const context = {
    console, document,
    sessionStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    },
    location: { reload() { reloads += 1; } }
  };
  context.window = context;
  vm.createContext(context);
  return {
    context, document, nodes, store,
    append(id, tag = 'div', value = '') {
      const node = document.createElement(tag); node.id = id; node.value = value; body.appendChild(node); return node;
    },
    reloads() { return reloads; }
  };
}

function runUpgradeSources(h, options = {}) {
  vm.runInContext(gateSource, h.context, { filename: 'upgrade-safety-gate.js' });
  if (options.speech !== false) vm.runInContext(speechSource, h.context, { filename: 'speech-hub-upgrade.js' });
  if (options.easy !== false) vm.runInContext(easyPrelude, h.context, { filename: 'easy-upgrade-prelude.js' });
}

/* Dirty work must win over every hot-upgrade request. The old owners remain
 * callable, no microphone teardown runs, and the only path forward is the
 * persistent clinician-controlled notice. */
{
  const h = makeUpgradeContext();
  const tx = h.append('transcript', 'textarea', 'patient conversation');
  h.append('noteBox', 'textarea', 'draft assessment and plan');
  const focused = h.append('focusedEditor', 'input', 'editing');
  h.document.activeElement = focused;
  h.context.capturing = true;
  h.context.phoneMicCode = 'phone-session';
  h.context._visitDirty = true;
  h.context.currentVisitAthenaBinding = { id: 'visit-bound' };
  h.context._visitDraftKey = () => 'visit-draft-key';
  h.store.set('visit-draft-key', '{"draft":true}');
  h.context.__mlsRecSegments = { isArmed() { return true; } };
  const hub = { version: '1.0.0', current() { return { id: 'visit', label: 'Visit recording' }; } };
  h.context.__mlsSpeechHub = hub;
  let easyRetires = 0;
  const oldEasy = { version: '3.7.2', installed: true, __retireForUpgrade() { easyRetires += 1; return true; } };
  h.context.__mlsEasyV32 = oldEasy;
  let voiceReverts = 0;
  h.context.__mlsCopilotVoiceV2 = { installed: true, version: 'cv2-old', revert() { voiceReverts += 1; } };
  h.context.__mlsVoiceAI = { installed: true, version: 'voice-old', revert() { voiceReverts += 1; } };
  h.context.__mlsDictateAnywhere = { installed: true, version: 'dictate-old', revert() { voiceReverts += 1; } };

  runUpgradeSources(h);
  assert.strictEqual(h.reloads(), 0, 'dirty workspace was hard-reloaded');
  assert.strictEqual(h.context.__mlsEasyV32, oldEasy, 'dirty Easy owner was replaced');
  assert.strictEqual(h.context.__mlsSpeechHub, hub, 'dirty speech hub was replaced');
  assert.strictEqual(easyRetires, 0, 'dirty Easy owner was retired');
  assert.strictEqual(voiceReverts, 0, 'dirty microphone owners were stopped');
  assert.strictEqual(h.context.__mlsEasyUpgradePolicy.deferred, true, 'Easy did not publish a deferred receipt');
  assert.strictEqual(h.context.__mlsSpeechHubUpgradePolicy.deferred, true, 'speech hub did not publish a deferred receipt');
  assert(h.nodes.mlsUpgradeReadyNotice, 'dirty upgrade did not show the persistent update-ready notice');
  assert.deepStrictEqual(Array.from(h.context.__mlsUpgradeSafety.pending()).sort(), ['easy-3.7.3', 'speech-hub-1.1.0']);

  const codes = Array.from(h.context.__mlsUpgradeSafety.inspect().reasons, reason => reason.code);
  for (const code of ['recording', 'phone-mic', 'recording-segment', 'microphone-owner', 'unsaved-visit', 'active-visit', 'transcript', 'note', 'saved-draft', 'focused-editor']) {
    assert(codes.includes(code), `safe-upgrade gate missed ${code}`);
  }
  assert.strictEqual(h.context.__mlsUpgradeSafety.tryReload(), false, 'notice button reloaded while work was dirty');
  assert.strictEqual(h.reloads(), 0);

  h.context.capturing = false;
  h.context.phoneMicCode = '';
  h.context._visitDirty = false;
  h.context.currentVisitAthenaBinding = null;
  h.context.__mlsRecSegments = { isArmed() { return false; } };
  hub.current = () => null;
  tx.value = '';
  h.nodes.noteBox.value = '';
  h.document.activeElement = h.document.body;
  h.store.delete('visit-draft-key');
  assert.strictEqual(h.context.__mlsUpgradeSafety.tryReload(), true, 'cleaned workspace could not explicitly apply the deferred update');
  assert.strictEqual(h.reloads(), 1, 'explicit deferred reload did not happen exactly once');
  assert.strictEqual(h.context.__mlsUpgradeSafety.tryReload(), true, 'scheduled manual reload lost its idempotent receipt');
  assert.strictEqual(h.reloads(), 1, 'double-clicking the manual update path scheduled a second reload');
}

/* An idle old document may auto-reload once. Both opaque upgrades share that
 * one reload receipt, preserve their old owners until unload, and repeated
 * evaluation in the same document cannot schedule a second reload. */
let idleStore;
{
  const h = makeUpgradeContext();
  const hub = { version: '1.0.0', current() { return null; } };
  const oldEasy = { version: '3.7.2', installed: true };
  h.context.__mlsSpeechHub = hub;
  h.context.__mlsEasyV32 = oldEasy;
  let voiceReverts = 0;
  h.context.__mlsCopilotVoiceV2 = { installed: true, version: 'old', revert() { voiceReverts += 1; } };
  runUpgradeSources(h);
  assert.strictEqual(h.reloads(), 1, 'idle opaque upgrades did not coalesce to one reload');
  assert.strictEqual(h.context.__mlsSpeechHub, hub, 'idle old speech hub was mutated before unload');
  assert.strictEqual(h.context.__mlsEasyV32, oldEasy, 'idle old Easy owner was replaced before unload');
  assert.strictEqual(voiceReverts, 0, 'idle microphone owner was unnecessarily torn down before unload');
  assert.strictEqual(h.context.__mlsSpeechHubUpgradePolicy.reloadScheduled, true);
  assert.strictEqual(h.context.__mlsEasyUpgradePolicy.reloadScheduled, true);
  vm.runInContext(speechSource, h.context, { filename: 'speech-hub-upgrade-repeat.js' });
  vm.runInContext(easyPrelude, h.context, { filename: 'easy-upgrade-repeat.js' });
  assert.strictEqual(h.reloads(), 1, 'same-document reevaluation scheduled another reload');
  idleStore = h.store;
}

/* If the freshly loaded document still exposes the old inline owners, the
 * automatic receipt prevents a reload loop. The visible manual path remains
 * available and can retry only after the clinician clicks it. */
let retriedStore;
{
  const h = makeUpgradeContext(idleStore);
  const hub = { version: '1.0.0', current() { return null; } };
  const oldEasy = { version: '3.7.2', installed: true };
  h.context.__mlsSpeechHub = hub;
  h.context.__mlsEasyV32 = oldEasy;
  runUpgradeSources(h);
  assert.strictEqual(h.reloads(), 0, 'automatic upgrade entered a cross-load reload loop');
  assert.strictEqual(h.context.__mlsSpeechHubUpgradePolicy.deferred, true);
  assert.strictEqual(h.context.__mlsEasyUpgradePolicy.deferred, true);
  assert.strictEqual(h.context.__mlsSpeechHub, hub);
  assert.strictEqual(h.context.__mlsEasyV32, oldEasy);
  assert(h.nodes.mlsUpgradeReadyNotice, 'reload-loop suppression lost the manual update path');
  assert.strictEqual(h.context.__mlsUpgradeSafety.tryReload(), true, 'manual retry was blocked on an idle page');
  assert.strictEqual(h.reloads(), 1, 'manual retry did not remain one explicit reload');
  retriedStore = h.store;
}

/* Once both target owners are current, their receipts and the shared loop
 * guard clear without another reload. */
{
  const h = makeUpgradeContext(retriedStore);
  h.context.__mlsSpeechHub = { version: '1.1.0', current() { return null; } };
  h.context.__mlsEasyV32 = { version: '3.7.3', installed: true };
  runUpgradeSources(h);
  assert.strictEqual(h.reloads(), 0, 'current owners triggered a reload');
  assert.strictEqual(h.store.has('mls.safeUpgrade.attempt.any'), false, 'successful upgrade left the loop guard armed');
  assert.strictEqual(h.store.has('mls.safeUpgrade.pendingKeys'), false, 'successful upgrade left pending receipts');
  assert(!h.nodes.mlsUpgradeReadyNotice, 'successful upgrade left the update notice visible');
}

/* A clean reversible Easy owner can retire in place; no hard reload is needed. */
{
  const h = makeUpgradeContext();
  h.context.__mlsSpeechHub = { version: '1.1.0', current() { return null; } };
  let retires = 0;
  h.context.__mlsEasyV32 = {
    version: '3.7.2', installed: true,
    __retireForUpgrade(next) { retires += 1; assert.strictEqual(next, '3.7.3'); return true; }
  };
  runUpgradeSources(h);
  assert.strictEqual(retires, 1, 'clean reversible Easy owner did not retire exactly once');
  assert.strictEqual(h.reloads(), 0, 'reversible Easy owner forced a hard reload');
}

/* Satellite loaders retire stale owners/tags, mark a pending exact version,
 * and remain idempotent until the new script executes. This includes the new
 * fixed Dictate token (the prior b432 path used a mutable app-version/Date URL). */
function loaderLine(asset) {
  const line = connect.split(/\r?\n/).find(candidate => candidate.includes(`var A='${asset}'`));
  assert(line, `${asset} loader missing`);
  return line;
}
function scriptTag(asset, version) {
  const attrs = {};
  if (asset) attrs['data-mls-asset'] = asset;
  if (version) attrs['data-mls-version'] = version;
  return {
    src: '', async: true, attrs,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    setAttribute(name, value) { attrs[name] = String(value); },
    removeAttribute(name) { delete attrs[name]; }
  };
}
function exerciseLoader({ asset, version, token, globalName, speech }) {
  const line = loaderLine(asset);
  assert(line.includes(`V='${version}'`) && line.includes(token), `${asset} lost exact version/token`);
  const oldTag = scriptTag(asset, 'legacy');
  const scripts = [oldTag];
  let reverts = 0;
  const oldApi = { installed: true, version: 'legacy', revert() { reverts += 1; this.installed = false; } };
  const document = {
    querySelectorAll(selector) {
      const match = selector.match(/data-mls-asset="([^"]+)"/);
      const wanted = match && match[1];
      return scripts.filter(tag => tag.getAttribute('data-mls-asset') === wanted);
    },
    createElement() { return scriptTag(); },
    body: { appendChild(tag) { scripts.push(tag); return tag; } },
    head: null, documentElement: null
  };
  const context = { document };
  context.window = context;
  context[globalName] = oldApi;
  if (speech) context.__mlsSpeechHubUpgradePolicy = { reloadRequired: false };
  vm.runInNewContext(line, context, { filename: `${asset}-loader.js` });
  assert.strictEqual(reverts, 1, `${asset} did not revert the old owner exactly once`);
  assert.strictEqual(oldApi.installed, false, `${asset} did not mark the old owner inactive`);
  assert.strictEqual(oldTag.getAttribute('data-mls-asset'), null, `${asset} left the old tag active`);
  assert.strictEqual(oldTag.getAttribute('data-mls-retired-asset'), asset, `${asset} did not receipt the retired tag`);
  const fresh = scripts.find(tag => tag !== oldTag && tag.getAttribute('data-mls-asset') === asset);
  assert(fresh, `${asset} did not append a replacement tag`);
  assert.strictEqual(fresh.getAttribute('data-mls-version'), version, `${asset} replacement tag lost its exact version`);
  assert.strictEqual(fresh.src, `${asset}?v=${token}`, `${asset} replacement URL is wrong`);
  const count = scripts.length;
  vm.runInNewContext(line, context, { filename: `${asset}-loader-repeat.js` });
  assert.strictEqual(reverts, 1, `${asset} repeated teardown while its replacement was pending`);
  assert.strictEqual(scripts.length, count, `${asset} appended a duplicate pending script`);

  if (speech) {
    const blockedTag = scriptTag(asset, 'legacy');
    const blockedScripts = [blockedTag];
    let blockedReverts = 0;
    const blockedApi = { installed: true, version: 'legacy', revert() { blockedReverts += 1; } };
    const blockedDocument = {
      querySelectorAll() { return blockedScripts; },
      createElement() { return scriptTag(); },
      body: { appendChild(tag) { blockedScripts.push(tag); } }, head: null, documentElement: null
    };
    const blocked = { document: blockedDocument, __mlsSpeechHubUpgradePolicy: { reloadRequired: true } };
    blocked.window = blocked; blocked[globalName] = blockedApi;
    vm.runInNewContext(line, blocked, { filename: `${asset}-loader-gated.js` });
    assert.strictEqual(blockedReverts, 0, `${asset} stopped the working owner while the hub upgrade was deferred`);
    assert.strictEqual(blockedScripts.length, 1, `${asset} loaded over a deferred old speech hub`);
  }
}

[
  /* 2026-07-28 owner order retired Copilot Voice: its loader line left
     mls-connect.js with the feature, so there is no loader to exercise. */
  /* 2026-07-28: feat_mls_voice_ai.js loader stood down with the Copilot Voice
     retirement - no loader line left to exercise (self-guard pinned below). */
  { asset: 'feat_mls_dictate_anywhere.js', version: 'da-1.1.1', token: '20260719da111h1', globalName: '__mlsDictateAnywhere', speech: true },
  { asset: 'feat_mls_loading_calm.js', version: 'lb-2.1.0', token: '20260719lb204', globalName: '__mlsLoadingCalm', speech: false },
  { asset: 'feat_mls_progress_stages.js', version: 'ps-1.4.0', token: '20260826ps140', globalName: '__mlsProgressStages', speech: false }
].forEach(exerciseLoader);

/* Each voice satellite also owns a version-aware self-guard, so a direct or
 * cached script execution cannot keep an old global/DOM owner alive. */
function ownerPrelude(file, version, endToken, globalName, legacyIds) {
  const source = read(file);
  const startToken = `var VERSION = '${version}'`;
  const body = between(source, startToken, endToken, `${file} self-guard`);
  const code = `;(function () { 'use strict';\n${body}\n})();`;

  const nodes = {};
  legacyIds.forEach(id => { nodes[id] = { id, remove() { delete nodes[id]; } }; });
  let reverts = 0;
  const old = { installed: true, version: 'legacy', revert() { reverts += 1; this.installed = false; } };
  const oldContext = { document: { getElementById(id) { return nodes[id] || null; } } };
  oldContext.window = oldContext; oldContext[globalName] = old;
  vm.runInNewContext(code, oldContext, { filename: `${file}-self-guard-old.js` });
  assert.strictEqual(reverts, 1, `${file} self-guard did not stop the old owner`);
  assert.strictEqual(oldContext[globalName], undefined, `${file} self-guard kept the stale global`);
  legacyIds.forEach(id => assert(!nodes[id], `${file} self-guard kept ${id}`));

  let currentReverts = 0;
  const current = { installed: true, version, revert() { currentReverts += 1; } };
  const currentContext = { document: { getElementById() { throw new Error('exact owner should return before DOM cleanup'); } } };
  currentContext.window = currentContext; currentContext[globalName] = current;
  vm.runInNewContext(code, currentContext, { filename: `${file}-self-guard-current.js` });
  assert.strictEqual(currentReverts, 0, `${file} self-guard reverted the exact owner`);
  assert.strictEqual(currentContext[globalName], current, `${file} self-guard replaced the exact owner`);
}

/* 2026-07-28: Copilot Voice retired with its loader - no owner prelude to guard. */
ownerPrelude('feat_mls_voice_ai.js', '1.1.2', "var ASSET = 'feat_mls_voice_ai.js'", '__mlsVoiceAI', ['mlsVoiceAiToast', 'mlsVoiceAiStyle']);
ownerPrelude('feat_mls_dictate_anywhere.js', 'da-1.1.1', 'var SR = window.SpeechRecognition', '__mlsDictateAnywhere', ['mlsDaChip', 'mlsDaDock', 'mlsDaCss']);

console.log('PASS same-tab owner upgrades: dirty work defers visibly, idle reloads once without loops, current owners clear receipts, stale loaders/tags and voice self-guards upgrade exactly once');
