'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

class FakeClassList {
  constructor(owner) { this.owner = owner; this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(String(name))); }
  remove(...names) { names.forEach(name => this.values.delete(String(name))); }
  contains(name) { return this.values.has(String(name)); }
}

class FakeText {
  constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.id = id;
    this.style = {};
    this.attributes = Object.create(null);
    this.classList = new FakeClassList(this);
    this.childNodes = [];
    this.parentNode = null;
    this.textContent = '';
    this.removed = false;
    this._listeners = Object.create(null);
    this._innerHTML = '';
  }
  set className(value) {
    this.classList.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }
  get className() { return Array.from(this.classList.values).join(' '); }
  set innerHTML(value) {
    this._innerHTML = String(value || '');
    if (this._innerHTML.includes('mlsTbIco')) {
      this.childNodes.slice().forEach(child => this.removeChild(child));
      const icon = new FakeElement('span'); icon.className = 'mlsTbIco';
      this.appendChild(icon); this.appendChild(new FakeElement('span'));
    }
  }
  get innerHTML() { return this._innerHTML; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, anchor) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = anchor == null ? this.childNodes.length : this.childNodes.indexOf(anchor);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
    child.parentNode = this;
    child.removed = false;
    return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    child.removed = true;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); else this.removed = true; }
  setAttribute(name, value) { this.attributes[String(name)] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, String(name)) ? this.attributes[String(name)] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, String(name)); }
  addEventListener(name, fn) { (this._listeners[name] || (this._listeners[name] = [])).push(fn); }
  querySelectorAll(selector) {
    const results = [];
    const matches = node => {
      if (selector.includes('[data-mls-topbar-owned="1"]') && node.getAttribute('data-mls-topbar-owned') === '1') return true;
      if (selector.includes('.mlsTbWho') && node.classList.contains('mlsTbWho')) return true;
      return selector.includes('[data-mls-action="staff-prep"]') && node.getAttribute('data-mls-action') === 'staff-prep';
    };
    const visit = node => node.childNodes.forEach(child => {
      if (child.nodeType === 1 && matches(child)) results.push(child);
      if (child.nodeType === 1) visit(child);
    });
    visit(this);
    return results;
  }
}

function addEventTarget(target) {
  const listeners = Object.create(null);
  target.addEventListener = function (type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); };
  target.removeEventListener = function (type, fn) {
    if (listeners[type]) listeners[type] = listeners[type].filter(item => item !== fn);
  };
  target.dispatchEvent = function (event) {
    (listeners[event.type] || []).slice().forEach(fn => fn(event));
    return true;
  };
  target.emit = function (type, event) { (listeners[type] || []).slice().forEach(fn => fn(event || {})); };
  target.listenerCount = function (type) { return (listeners[type] || []).length; };
  target.listeners = function (type) { return (listeners[type] || []).slice(); };
  return target;
}

function timerHarness() {
  let sequence = 0;
  const pending = new Map();
  return {
    setTimeout(fn) { const id = ++sequence; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    callbacks() { return Array.from(pending.values()); },
    count() { return pending.size; }
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

function sliceBetween(source, startText, endText, name) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `${name}: could not extract ${startText}`);
  return source.slice(start, end);
}

function makeBoundaryDocument() {
  const nodes = new Map();
  const add = (id, tag = 'div') => { const node = new FakeElement(tag, id); nodes.set(id, node); return node; };
  const modal = add('patientModal'); modal.classList.add('modal-bg', 'show'); modal.setAttribute('aria-hidden', 'false');
  const name = add('patientName', 'input'); name.type = 'text'; name.value = 'Account A patient'; name.listenerToken = { preserved: true };
  const note = add('patientNote', 'textarea'); note.type = ''; note.value = 'Account A private note';
  const checkbox = add('patientFlag', 'input'); checkbox.type = 'checkbox'; checkbox.checked = true;
  const select = add('patientSelect', 'select'); select.type = ''; select.selectedIndex = 2;
  const viewBody = add('viewBody', 'textarea'); viewBody.value = 'Account A saved visit';
  const viewMeta = add('viewMeta'); viewMeta.textContent = 'Account A MRN';
  const helpAnswer = add('helpAnswer'); helpAnswer.textContent = 'Account A answer';
  const viewTitle = add('viewTitle'); viewTitle.textContent = 'Account A visit';
  const intake = add('intakeView'); intake.style.display = 'block'; intake.scrollTop = 88;
  const toast = add('toast'); toast.classList.add('show'); toast.textContent = 'Account A complete';
  const document = {
    getElementById(id) { const node = nodes.get(String(id)); return node && !node.removed ? node : null; },
    querySelectorAll(selector) {
      if (selector === '.modal-bg.show') return modal.classList.contains('show') ? [modal] : [];
      if (selector === '.modal-bg input,.modal-bg textarea,.modal-bg select') return [name, note, checkbox, select];
      return [];
    },
    createTextNode(value) { return new FakeText(String(value)); },
    createElement(tag) { return new FakeElement(tag); }
  };
  return { document, nodes, add, modal, name, note, checkbox, select, viewBody, viewMeta, helpAnswer, viewTitle, intake, toast };
}

function testSessionBoundary(pageName) {
  const html = read(pageName);
  const timers = timerHarness();
  const dom = makeBoundaryDocument();
  const localStorage = memoryStorage();
  const statusResets = [];
  const assistantResets = [];
  const boundaryEvents = [];
  let setupOpens = 0;
  let bannerShows = 0;
  let intakeResets = 0;

  class FakeEvent { constructor(type) { this.type = type; } }
  class FakeCustomEvent extends FakeEvent { constructor(type, init) { super(type); this.detail = init && init.detail; } }
  const context = addEventTarget({
    console, Event: FakeEvent, CustomEvent: FakeCustomEvent,
    document: dom.document, localStorage,
    session: { email: 'doctor-a@example.test' },
    bkUser: { email: 'doctor-a@example.test', role: 'head' },
    getSessionEmail() { return context.session && context.session.email || ''; },
    backendMode() { return true; }, bkToken() { return 'token-a'; },
    uns(key) { return `${context.__mlsSessionAccount || 'none'}::${key}`; },
    getName() { return ''; },
    openSetup() { setupOpens += 1; },
    _showAssistInstallBanner() { bannerShows += 1; },
    resetIntakeForm() { intakeResets += 1; },
    postMessage() {},
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval() { return 1; }, clearInterval() {},
    __mlsStatusCenter: { resetSession(next, detail) { statusResets.push({ next, reason: detail.reason }); } },
    __mlsAsst: { resetSession(next, detail) { assistantResets.push({ next, reason: detail.reason }); } }
  });
  context.window = context;
  context.addEventListener('mls:session-boundary', event => boundaryEvents.push(event.detail));

  const roleSource = sliceBetween(html, 'var _mlsRoleDisplayOwned=[];', 'function isLawyerUser', pageName);
  const boundarySource = sliceBetween(html, 'var sfSessionUiEpoch=0', 'function startSession', pageName);
  const setupSource = sliceBetween(html, 'function maybePromptSetup()', '/* ===== MLS Help', pageName);
  const assistSource = sliceBetween(html, 'function maybePromptInstallAssist(', 'function _dismissAssistPrompt', pageName);
  vm.runInNewContext([roleSource, boundarySource, setupSource, assistSource].join('\n'), context, { filename: `${pageName}-session-boundary.js` });

  context.__mlsResetSessionBoundary('doctor-a@example.test', { reason: 'session-start', force: true });

  // Account A owns visible clinical state, a receptionist nav mutation, and all three prompt generations.
  dom.modal.classList.add('show'); dom.modal.setAttribute('aria-hidden', 'false');
  dom.name.value = 'Account A patient'; dom.note.value = 'Account A private note'; dom.checkbox.checked = true; dom.select.selectedIndex = 2;
  dom.viewBody.value = 'Account A saved visit'; dom.viewMeta.textContent = 'Account A MRN'; dom.helpAnswer.textContent = 'Account A answer';
  dom.intake.style.display = 'block'; dom.intake.scrollTop = 88; dom.toast.classList.add('show'); dom.toast.textContent = 'Account A complete';
  const banner = dom.add('assistInstallBanner');

  const nav = new FakeElement('button', 'nav_patients'); nav.style.display = 'inline-flex';
  const canonicalText = new FakeText('Patients '); const badge = new FakeElement('span', 'navPtCount'); badge.textContent = '12';
  nav.appendChild(canonicalText); nav.appendChild(badge);
  context.mlsRoleHide(nav); context.mlsRoleSetNavText(nav, 'Front desk ');

  context.maybePromptSetup();
  context.maybePromptInstallAssist(context.sfSessionUiEpoch, context.sfSessionUiAccount);
  vm.runInNewContext(`
    var __oldStartEpoch=sfSessionUiEpoch, __oldStartAccount=sfSessionUiAccount;
    sfAssistPromptStartTimer=setTimeout(function(){
      sfAssistPromptStartTimer=0;
      if(sfSessionPromptValid(__oldStartEpoch,__oldStartAccount)) maybePromptInstallAssist(__oldStartEpoch,__oldStartAccount);
    },1600);
  `, context);
  assert.strictEqual(timers.count(), 3, `${pageName}: did not arm all named session prompt timers`);
  assert.strictEqual(context.listenerCount('message'), 1, `${pageName}: extension prompt listener was not armed`);
  const staleCallbacks = timers.callbacks();
  const stalePong = context.listeners('message')[0];

  // The real logout calls this synchronously before purging credentials.
  context.__mlsResetSessionBoundary('', { reason: 'logout', force: true });
  assert.strictEqual(timers.count(), 0, `${pageName}: logout retained a named prompt timer`);
  assert.strictEqual(context.listenerCount('message'), 0, `${pageName}: logout retained the extension pong listener`);
  assert.strictEqual(dom.modal.classList.contains('show'), false, `${pageName}: Account A modal stayed open`);
  assert.strictEqual(dom.modal.getAttribute('aria-hidden'), 'true', `${pageName}: closed modal remained exposed to accessibility APIs`);
  assert.strictEqual(dom.name.value, ''); assert.strictEqual(dom.note.value, '');
  assert.strictEqual(dom.checkbox.checked, false); assert.strictEqual(dom.select.selectedIndex, 0);
  assert.strictEqual(dom.viewBody.value, ''); assert.strictEqual(dom.viewMeta.textContent, ''); assert.strictEqual(dom.helpAnswer.textContent, '');
  assert.strictEqual(dom.intake.style.display, 'none'); assert.strictEqual(dom.intake.scrollTop, 0);
  assert.strictEqual(dom.toast.classList.contains('show'), false); assert.strictEqual(dom.toast.textContent, '');
  assert.strictEqual(banner.removed, true, `${pageName}: Account A install banner survived logout`);
  assert.strictEqual(dom.name.listenerToken.preserved, true, `${pageName}: reusable modal DOM/listeners were destroyed`);
  assert.strictEqual(nav.style.display, 'inline-flex', `${pageName}: role-owned display did not restore canonically`);
  assert.strictEqual(canonicalText.data, 'Patients ', `${pageName}: canonical nav label was not restored`);
  assert.strictEqual(nav.childNodes[1], badge, `${pageName}: #navPtCount was replaced by role reconciliation`);
  assert.strictEqual(badge.textContent, '12', `${pageName}: #navPtCount content was destroyed`);
  assert(intakeResets >= 1, `${pageName}: intake reset hook was not invoked`);
  assert.strictEqual(context.__mlsSessionAccount, '', `${pageName}: logout boundary retained Account A identity`);

  context.session = { email: 'doctor-b@example.test' };
  context.bkUser = { email: 'doctor-b@example.test', role: 'user' };
  context.__mlsResetSessionBoundary('doctor-b@example.test', { reason: 'session-start', force: true });
  staleCallbacks.forEach(callback => callback());
  stalePong({ data: { source: 'mls-ext', type: 'mlsPong' } });

  assert.strictEqual(setupOpens, 0, `${pageName}: Account A setup prompt resurrected in Account B`);
  assert.strictEqual(bannerShows, 0, `${pageName}: Account A extension banner resurrected in Account B`);
  assert.strictEqual(localStorage.getItem('doctor-b@example.test::setupPrompted'), null, `${pageName}: stale Account A timer wrote Account B setup state`);
  assert.strictEqual(localStorage.getItem('doctor-b@example.test::assistPromptSeen'), null, `${pageName}: stale Account A pong wrote Account B extension state`);
  assert.deepStrictEqual(statusResets.map(item => item.next), ['doctor-a@example.test', '', 'doctor-b@example.test']);
  assert.deepStrictEqual(assistantResets.map(item => item.next), ['doctor-a@example.test', '', 'doctor-b@example.test']);
  assert.strictEqual(boundaryEvents[boundaryEvents.length - 1].nextAccount, 'doctor-b@example.test');

  assert(html.includes('window.__mlsSessionAccount=next;'), `${pageName}: menu identity is not bound to the synchronous session boundary`);
  assert(/sfAssistPromptStartTimer\s*=\s*setTimeout/.test(html), `${pageName}: startup prompt timer is anonymous`);
  assert(/sfSetupPromptTimer\s*=\s*setTimeout/.test(html), `${pageName}: setup prompt timer is anonymous`);
  assert(/sfAssistPromptPingTimer\s*=\s*setTimeout/.test(html), `${pageName}: extension ping timer is anonymous`);
  assert(html.includes("mlsRoleSetNavText(npt,'"), `${pageName}: receptionist nav does not use reversible text ownership`);
  assert(!/npt\.innerHTML\s*=/.test(html), `${pageName}: receptionist role still destroys #navPtCount markup`);
}

function menuKeys(panel) {
  return panel.childNodes.map(node => node.getAttribute && node.getAttribute('data-mls-menu-key')).filter(Boolean);
}

function staffPrepCount(panel) {
  return panel.childNodes.filter(node => node.getAttribute && node.getAttribute('data-mls-action') === 'staff-prep').length;
}

function whoText(panel) {
  const node = panel.childNodes.find(child => child.classList && child.classList.contains('mlsTbWho'));
  return node ? node.textContent : '';
}

function testMenuReconciliation() {
  const source = read('feat_mls_topbar_unify.js');
  const controls = Object.create(null);
  ['askCopilotHdrBtn', 'intakeBtn', 'customWidgetHdrBtn', 'mlsAthenaDoctorBtn'].forEach(id => { controls[id] = new FakeElement('button', id); });
  const onclickControls = Object.create(null);
  ['openTemplates', 'openSettings', 'logout('].forEach(name => { onclickControls[name] = new FakeElement('button'); });
  const document = { createElement(tag) { return new FakeElement(tag); } };
  const context = {
    console, document,
    bkUser: { email: 'doctor-a@example.test', role: 'head' },
    __mlsSessionAccount: 'doctor-a@example.test',
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
    gid(id) { return controls[id] || null; },
    byOnclick(name) { return () => onclickControls[name] || null; },
    activateStaffPrepFromMenu() {}, closePanel() {}, apply() {},
    backendMode() { return true; },
    getSessionEmail() { return this.__mlsSessionAccount; }
  };
  context.window = context;
  const declarations = sliceBetween(source, 'var MENU_ITEMS = [', '// ---- styles ----', 'feat_mls_topbar_unify.js');
  const renderers = sliceBetween(source, 'function createMenuRow', 'function buildMenu', 'feat_mls_topbar_unify.js');
  vm.runInNewContext(`${declarations}\n${renderers}`, context, { filename: 'topbar-account-menu.js' });

  const panel = new FakeElement('div', 'mlsTbMenuPanel');
  const external = new FakeElement('button', 'external-row'); panel.appendChild(external);
  const staleStaffOne = new FakeElement('button'); staleStaffOne.setAttribute('data-mls-action', 'staff-prep'); panel.appendChild(staleStaffOne);
  const staleStaffTwo = new FakeElement('button'); staleStaffTwo.setAttribute('data-mls-action', 'staff-prep'); staleStaffTwo.setAttribute('data-mls-topbar-owned', '1'); panel.appendChild(staleStaffTwo);

  context.reconcileMenuContent(panel);
  assert.strictEqual(whoText(panel), 'doctor-a@example.test');
  assert.strictEqual(staffPrepCount(panel), 1, 'clinician menu did not converge duplicate Staff Prep rows to exactly one');
  assert.deepStrictEqual(menuKeys(panel), ['staff-prep', 'ask', 'intake', 'templates', 'custom-widget', 'athena-help', 'settings', 'logout']);
  assert(panel.childNodes.includes(external), 'menu reconciliation removed a row owned by another module');

  // Logout boundary arrives before bkUser is cleared. The explicit empty account must win over stale Account A identity.
  context.__mlsSessionAccount = '';
  context.reconcileMenuContent(panel);
  assert.strictEqual(whoText(panel), '', 'logout menu retained Account A identity');
  assert.deepStrictEqual(menuKeys(panel), [], 'logout menu retained Account A capabilities');
  assert.strictEqual(staffPrepCount(panel), 0, 'logout menu retained Staff Prep');

  // B is known before /me returns. Fail closed until the new identity matches, then rebuild for every role transition.
  context.__mlsSessionAccount = 'frontdesk-b@example.test';
  context.reconcileMenuContent(panel);
  assert.strictEqual(whoText(panel), 'frontdesk-b@example.test');
  assert.deepStrictEqual(menuKeys(panel), [], 'new account inherited the prior account role while identity was pending');

  context.bkUser = { email: 'frontdesk-b@example.test', role: 'receptionist' };
  context.reconcileMenuContent(panel);
  assert.deepStrictEqual(menuKeys(panel), ['staff-prep', 'ask', 'athena-help', 'settings', 'logout']);
  assert.strictEqual(staffPrepCount(panel), 1, 'receptionist menu did not expose exactly one Staff Prep');

  context.bkUser = { email: 'frontdesk-b@example.test', role: 'user', lite: true };
  context.reconcileMenuContent(panel);
  assert.deepStrictEqual(menuKeys(panel), ['settings', 'logout'], 'lite transition retained standard or clinical rows');

  context.bkUser = { email: 'frontdesk-b@example.test', role: 'user', lite: false };
  context.reconcileMenuContent(panel);
  assert.strictEqual(staffPrepCount(panel), 1, 'same-account clinician transition did not restore exactly one Staff Prep');
  assert(menuKeys(panel).includes('intake') && menuKeys(panel).includes('templates'), 'clinician transition did not restore clinical rows');
  assert.strictEqual(whoText(panel), 'frontdesk-b@example.test');

  // The backend-off local evaluator has no /api/me user object. Its signed
  // account is authoritative for the one fixed clinician role, but a stale
  // user object must still fail closed instead of crossing accounts.
  context.__mlsSessionAccount = 'local-clinician@example.test';
  context.bkUser = null;
  context.backendMode = () => false;
  context.reconcileMenuContent(panel);
  assert.strictEqual(staffPrepCount(panel), 1, 'local signed clinician lost the Menu-owned Staff Prep entry');
  assert.deepStrictEqual(menuKeys(panel), ['staff-prep', 'ask', 'intake', 'templates', 'custom-widget', 'athena-help', 'settings', 'logout']);
  assert.strictEqual(whoText(panel), 'local-clinician@example.test');

  context.bkUser = { email: 'stale-other-account@example.test', role: 'head' };
  context.reconcileMenuContent(panel);
  assert.deepStrictEqual(menuKeys(panel), [], 'local account inherited a stale mismatched role');

  // The same missing user is never sufficient in hosted mode: wait for the
  // exact lexical /api/me identity, then rebuild from that role.
  context.bkUser = null;
  context.backendMode = () => true;
  context.reconcileMenuContent(panel);
  assert.deepStrictEqual(menuKeys(panel), [], 'hosted account bypassed the pending-identity boundary');
  context.bkUser = { email: 'local-clinician@example.test', role: 'user', lite: false };
  context.reconcileMenuContent(panel);
  assert.strictEqual(staffPrepCount(panel), 1, 'hosted exact lexical identity did not restore Staff Prep');

  assert(source.includes('reconcileMenuContent(existing.querySelector("#" + PANEL_ID))'), 'existing menu is not reconciled on repeated apply');
  assert(source.includes('"mls:session-boundary"'), 'menu is not subscribed to account boundaries');
  assert(source.includes('typeof bkUser !== "undefined"') && source.indexOf('typeof bkUser !== "undefined"') < source.indexOf('window.bkUser || null'),
    'topbar does not prefer ScribeFlow\'s authoritative lexical bkUser binding over its compatibility shadow');
  assert(source.includes('typeof backendMode === "function" ? !!backendMode() : true'),
    'unknown runtime mode does not default to hosted fail-closed behavior');
}

function testLexicalBkUserBridge() {
  const source = read('feat_mls_topbar_unify.js');
  const identitySource = sliceBetween(source, 'function normalizeAccount', '// ---- styles ----', 'topbar lexical identity bridge');
  const context = {
    console,
    __mlsSessionAccount: 'lexical-clinician@example.test',
    backendMode() { return true; },
    getSessionEmail() { return this.__mlsSessionAccount; },
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
  };
  context.window = context;
  vm.createContext(context);

  // A classic-script top-level let is visible to later scripts but is not a
  // window property. Install a hostile/obsolete compatibility shadow to make
  // the preference observable rather than merely checking source text.
  vm.runInContext('let bkUser={email:"lexical-clinician@example.test",role:"receptionist"};', context);
  context.bkUser = { email: 'window-shadow@example.test', role: 'head', isAdmin: true };
  vm.runInContext(identitySource, context, { filename: 'topbar-lexical-identity.js' });

  let state = vm.runInContext('authoritativeSessionState()', context);
  let role = vm.runInContext('roleState()', context);
  assert.strictEqual(state.source, 'lexical-bkUser', 'topbar preferred a mutable window.bkUser shadow');
  assert.strictEqual(state.pending, false, 'matching lexical /api/me identity stayed pending');
  assert.strictEqual(role.receptionist, true, 'role did not come from the lexical /api/me identity');
  assert.strictEqual(role.lawyer, false, 'window shadow leaked a role into the active account');

  context.__mlsSessionAccount = 'window-shadow@example.test';
  state = vm.runInContext('authoritativeSessionState()', context);
  assert.strictEqual(state.pending, true, 'a window shadow bypassed the mismatched lexical identity gate');
  assert.strictEqual(state.user, null, 'mismatched hosted lexical identity remained usable');

  vm.runInContext('bkUser=null;', context);
  context.__mlsSessionAccount = 'local-clinician@example.test';
  context.backendMode = () => false;
  state = vm.runInContext('authoritativeSessionState()', context);
  assert.strictEqual(state.source, 'local-session', 'backend-off signed account did not use its narrow local identity path');
  assert.strictEqual(state.pending, false, 'backend-off signed account incorrectly waited for /api/me');
  assert.strictEqual(state.user.email, 'local-clinician@example.test');
  assert.strictEqual(state.user.role, 'user');

  context.backendMode = () => true;
  state = vm.runInContext('authoritativeSessionState()', context);
  assert.strictEqual(state.pending, true, 'hosted missing lexical identity did not fail closed');
  assert.strictEqual(state.user, null, 'hosted mode synthesized a clinician role without /api/me');
}

testSessionBoundary('ScribeFlow.html');
testSessionBoundary('ScribeFlow-staging.html');
testMenuReconciliation();
testLexicalBkUserBridge();
assert(read('ScribeFlow.html').includes("window.__MLS_AV='b454'"), 'web asset stamp changed from b434');
assert(read('sw.js').includes("const CACHE = 'mls-v41'"), 'service-worker cache stamp changed from v22');
console.log('PASS same-tab UI account isolation: A -> logout -> B clears PHI/modals/intake/prompts, restores role markup, and reconciles account-gated menu rows');
