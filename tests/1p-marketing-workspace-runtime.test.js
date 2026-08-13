'use strict';

/* Executed, networkless contract for the 1p-only free Marketing workspace. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_marketing.js'), 'utf8');
const showcase = fs.readFileSync(path.join(root, '1p', 'marketing', 'index.html'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function makeNode(tag, document) {
  let inertValue = false;
  const inertPrototype = Object.create(Object.prototype, {
    inert: { enumerable: true, configurable: true, get() { return inertValue; }, set(value) { inertValue = !!value; } }
  });
  const node = {
    tagName: String(tag || 'div').toUpperCase(), id: '', type: '', value: '', checked: false,
    hidden: false, disabled: false, selectedIndex: 0, innerHTML: '', textContent: '', className: '',
    style: {}, attributes: {}, children: [], parentNode: null, listeners: {},
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    insertBefore(child, before) { child.parentNode = this; const at = this.children.indexOf(before); if (at < 0) this.children.push(child); else this.children.splice(at, 0, child); return child; },
    removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) { if (this.listeners[name]) this.listeners[name] = this.listeners[name].filter(x => x !== fn); },
    fire(name, extra = {}) { for (const fn of [...(this.listeners[name] || [])]) fn(Object.assign({ target: this, key: '', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }, extra)); },
    focus() { document.activeElement = this; }, click() { this.fire('click'); },
    querySelector(selector) { return selector === '[data-mls-menu-key="athena-help"]' ? this.children.find(x => x.getAttribute('data-mls-menu-key') === 'athena-help') || null : null; },
    querySelectorAll(selector) { return this.id === 'mlsP1MktWorkspace' && /(input|textarea|select|button)/.test(selector) ? Object.values(document.ui).filter(el => {
      if (selector === 'input,textarea,select') return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (selector === 'button,input,select,textarea') return /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
      return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && String(el.type || 'text').toLowerCase() !== 'number' && String(el.type || 'text').toLowerCase() !== 'checkbox');
    }) : []; },
    closest() { return null; }
  };
  Object.setPrototypeOf(node, inertPrototype);
  return node;
}

const UI = [
  ['mlsP1MktClose','button'],['mlsP1MktClear','button'],['mlsP1MktAudit','button'],
  ['mlsP1MktWebsite','input'],['mlsP1MktHours','input'],['mlsP1MktServices','input'],['mlsP1MktPhotos','input'],
  ['mlsP1MktScore','div'],['mlsP1MktScoreNote','div'],['mlsP1MktChecklist','ul'],['mlsP1MktListingOutput','textarea'],
  ['mlsP1MktListingCopy','button'],['mlsP1MktListingDownload','button'],
  ['mlsP1MktReplySentiment','select'],['mlsP1MktReplyCategory','select'],['mlsP1MktReplyTone','select'],
  ['mlsP1MktDraftReply','button'],['mlsP1MktReplyOutput','textarea'],['mlsP1MktReplyGuard','div'],['mlsP1MktReplyCopy','button'],['mlsP1MktReplyDownload','button'],
  ['mlsP1MktCampaignChannel','select'],['mlsP1MktCampaignTiming','input'],['mlsP1MktReviewLink','input'],['mlsP1MktCampaignMessage','textarea'],
  ['mlsP1MktConsent','input'],['mlsP1MktOptout','input'],['mlsP1MktNoGate','input'],['mlsP1MktPlanCampaign','button'],['mlsP1MktCampaignOutput','textarea'],['mlsP1MktCampaignCopy','button'],['mlsP1MktCampaignDownload','button'],
  ['mlsP1MktAdService','input'],['mlsP1MktAdArea','input'],['mlsP1MktAdBudget','input'],['mlsP1MktAdDays','input'],['mlsP1MktPlanAds','button'],['mlsP1MktAdsOutput','textarea'],['mlsP1MktAdsCopy','button'],['mlsP1MktAdsDownload','button'],['mlsP1MktReceipt','div']
];

function runtime(role = 'user', options = {}) {
  const windowEvents = {}, documentEvents = {}, ui = {}, mutationObservers = [];
  const document = { activeElement: null, currentScript: null, ui,
    getElementById(id) { return ui[id] || find(this.documentElement, id); },
    createElement(tag) { return makeNode(tag, document); },
    querySelectorAll(selector) { return /mlsPtab_reviews|mls-menu-reviews|ez3sReviews/.test(selector) ? [legacyTab, legacyMenu] : []; },
    addEventListener(name, fn) { (documentEvents[name] ||= []).push(fn); },
    removeEventListener(name, fn) { if (documentEvents[name]) documentEvents[name] = documentEvents[name].filter(x => x !== fn); }
  };
  function find(tree, id) { if (!tree) return null; if (tree.id === id) return tree; for (const child of tree.children || []) { const found = find(child, id); if (found) return found; } return null; }
  const html = makeNode('html', document), head = makeNode('head', document), body = makeNode('body', document);
  html.appendChild(head); html.appendChild(body); Object.assign(document, { documentElement: html, head, body });
  for (const [id, tag] of UI) { ui[id] = makeNode(tag, document); ui[id].id = id; }
  ui.mlsP1MktPhotos.type = ui.mlsP1MktConsent.type = ui.mlsP1MktOptout.type = ui.mlsP1MktNoGate.type = 'checkbox';
  const panel = makeNode('div', document); panel.id = 'mlsTbMenuPanel'; body.appendChild(panel);
  const topbarMenu = makeNode('button', document); topbarMenu.id = 'mlsTbMenuBtn'; body.appendChild(topbarMenu);
  const toolsBtn = makeNode('button', document); toolsBtn.id = 'mlsToolsBtn'; body.appendChild(toolsBtn);
  const athena = makeNode('button', document); athena.setAttribute('data-mls-menu-key', 'athena-help'); panel.appendChild(athena);
  const toolsMenu = makeNode('div', document); toolsMenu.id = 'mlsToolsMenu'; body.appendChild(toolsMenu);
  const legacyTab = makeNode('button', document), legacyMenu = makeNode('button', document);
  legacyTab.id = 'mlsPtab_reviews'; legacyMenu.className = 'mls-menu-reviews'; body.appendChild(legacyTab); body.appendChild(legacyMenu);
  const reachCalls = [];
  const reach = {
    open(kind) { reachCalls.push(['open', kind]); return 'open-' + kind; },
    openReviews() { reachCalls.push(['openReviews']); return 'old-reviews'; },
    openContext(kind) { reachCalls.push(['openContext', kind]); return 'context-' + kind; },
    send() { reachCalls.push(['send']); return 'send'; }
  };
  const originals = { open: reach.open, openReviews: reach.openReviews, openContext: reach.openContext, send: reach.send };
  const account = { resolved: true, ready: true, email: 'doctor@example.invalid', role, epoch: 1, isAdmin: role === 'admin', isHead: role === 'head', isLawyer: role === 'lawyer' };
  let confirmResult = options.confirm !== false;
  const window = {
    __MLS_P1_PREVIEW: { enabled: true, route: '/1p/' }, __mlsPatientReach: options.delayedReach ? undefined : reach,
    __mlsP1MarketingIdentity: () => Object.assign({}, account, { resolved: account.resolved === true && account.ready === true }),
    getPracticeName: () => 'Synthetic Spine Practice', clinicalProviderName: () => 'Wrong Login Account', getProviderName: () => options.provider === undefined ? 'Dr Preview' : options.provider, getProviderCred: () => 'MD', getSpec: () => 'Spine care',
    getClinicPhone: () => '555-0100', getClinicAddress: () => '100 Preview Way', getGoogleBusinessUrl: () => 'https://example.invalid/maps',
    __mlsTopbar: { closeMenu() {} }, toast() {}, confirm: () => confirmResult,
    addEventListener(name, fn) { (windowEvents[name] ||= []).push(fn); },
    removeEventListener(name, fn) { if (windowEvents[name]) windowEvents[name] = windowEvents[name].filter(x => x !== fn); },
    dispatch(name, detail = {}) {
      if (name === 'mls:session-boundary') account.ready = false;
      if (name === 'mls:p1-marketing-identity-ready') account.ready = true;
      for (const fn of [...(windowEvents[name] || [])]) fn({ detail });
    }
  };
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.connected = false; mutationObservers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  };
  const install = makeNode('script', document); install.setAttribute('data-mls-install-token', 'marketing-test-token'); document.currentScript = install;
  window.__mlsP1MarketingLoader = { installed: true, version: 'mkt-p1-1.0.0', installToken: 'marketing-test-token', state: 'loading' };
  let copied = '', resolveCopy;
  const navigator = { clipboard: { writeText(value) { copied = value; return new Promise(resolve => { resolveCopy = resolve; }); } } };
  const context = { window, document, navigator, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Promise, Object, Array, String, Number, Math, RegExp, JSON, console };
  window.window = window; window.document = document; window.navigator = navigator; window.confirm = () => confirmResult;
  vm.createContext(context); vm.runInContext(source, context, { filename: '1p-feat_mls_marketing.js' });
  return { window, document, ui, account, reach, originals, reachCalls, api: window.__mlsP1Marketing,
    copied: () => copied, resolveCopy: () => resolveCopy && resolveCopy(), panel, topbarMenu, toolsBtn, toolsMenu, legacyTab, legacyMenu,
    triggerMutation() { for (const observer of mutationObservers) if (observer.connected) observer.callback([]); },
    setConfirm(value) { confirmResult = !!value; }, installReach(next = reach) { window.__mlsPatientReach = next; window.__mlsP1Marketing.reconcile(); return next; } };
}

/* Exact role matrix is fail-closed and free for canonical practice users. */
for (const role of ['user','doctor','head','admin','owner','practice_owner']) { const r = runtime(role); eq(r.api.allowed(), true, role + ' was denied'); r.api.revert(); }
for (const role of ['receptionist','lawyer','patient','public','nurse','']) { const r = runtime(role); eq(r.api.allowed(), false, role + ' was allowed'); r.api.revert(); }
for (const role of ['receptionist','lawyer','public']) {
  const r = runtime(role);
  eq(r.reach.open('reviews'), false, role + ' could programmatically open retired Reviews');
  eq(r.reach.openReviews(), false, role + ' could call retired openReviews');
  eq(r.reach.openContext('reviews'), false, role + ' could call retired Reviews context');
  eq(r.reach.open('send'), 'open-send', role + ' lost the separate non-review Patient Reach route');
  eq(r.reach.send(), 'send', role + ' lost the separate Send-to-patient flow');
  r.api.revert();
  eq(r.reach.open, r.originals.open, role + ' revert did not restore PatientReach.open');
}
{
  const r = runtime('user'); r.window.dispatch('mls:session-boundary', { nextAccount: r.account.email, epoch: 2 });
  eq(r.reach.open('reviews'), false, 'unresolved boundary identity could programmatically open retired Reviews');
  eq(r.reach.open('send'), 'open-send', 'unresolved identity lost non-review Patient Reach route');
  r.api.revert();
}
{
  const r = runtime('nurse'); r.account.isAdmin = true;
  eq(r.api.allowed(), false, 'contradictory nurse+admin flag bypassed canonical role gate'); r.api.revert();
}
{
  const r = runtime('mystery'); r.account.isHead = true;
  eq(r.api.allowed(), false, 'contradictory unknown+head flag bypassed canonical role gate'); r.api.revert();
}

{
  const r = runtime('owner', { provider: '' }); r.api.open();
  const host = r.document.getElementById('mlsP1MktWorkspace');
  ok(/Provider:<\/b> Add in Settings/.test(host.innerHTML), 'owner login identity was inferred as a clinician');
  ok(!/Wrong Login Account/.test(host.innerHTML), 'clinicalProviderName login fallback leaked into provider identity');
  r.api.close(); r.api.revert();
}

{
  const r = runtime('doctor'), door = r.document.getElementById('mlsP1MktDoor'), calm = r.document.getElementById('mlsP1MktCalmDoor');
  r.api.open();
  r.window.dispatch('mls:session-boundary', { nextAccount: r.account.email, epoch: 2 });
  eq(r.document.getElementById('mlsP1MktWorkspace'), null, 'same-email reauth boundary retained old workspace');
  eq(door.hidden, true, 'same-email boundary re-showed stale clinician door before /api/me');
  eq(calm.hidden, true, 'same-email boundary re-showed stale Calm door before /api/me');
  eq(r.api.allowed(), false, 'same-email boundary allowed stale role through direct API before /api/me');
  r.account.epoch = 2; r.account.role = 'receptionist';
  r.window.dispatch('mls:p1-marketing-identity-ready');
  eq(door.hidden, true, 'resolved receptionist reauth exposed Marketing door');
  eq(r.api.open(), false, 'resolved receptionist reauth opened Marketing through API');
  r.api.revert();
}

{
  const r = runtime('doctor'), door = r.document.getElementById('mlsP1MktDoor'), calm = r.document.getElementById('mlsP1MktCalmDoor');
  r.api.open(); r.ui.mlsP1MktAdService.value = 'Synthetic'; r.ui.mlsP1MktPlanAds.click();
  r.account.role = 'receptionist'; r.window.dispatch('mls:p1-marketing-identity-ready');
  eq(r.document.getElementById('mlsP1MktWorkspace'), null, 'same-email authoritative role demotion retained workspace');
  eq(door.hidden, true, 'same-email authoritative role demotion retained classic door');
  eq(calm.hidden, true, 'same-email authoritative role demotion retained Calm door');
  eq(r.reach.open('reviews'), false, 'same-email demoted role could open retired Reviews');
  eq(r.reach.open('send'), 'open-send', 'same-email demotion changed non-review Patient Reach route');
  r.api.revert();
}

{
  const r = runtime('user');
  const door = r.document.getElementById('mlsP1MktDoor');
  const calmDoor = r.document.getElementById('mlsP1MktCalmDoor');
  ok(door && !door.hidden && !door.disabled, 'eligible top-right Menu door is not visible');
  ok(calmDoor && calmDoor.parentNode === r.toolsMenu && !calmDoor.hidden, 'eligible Calm/Lite Tools door is not visible');
  eq(r.toolsMenu.children.filter(node => node.id === 'mlsP1MktCalmDoor').length, 1, 'Calm Tools contains duplicate Marketing rows');
  eq(r.panel.children.indexOf(door) + 1, r.panel.children.indexOf(r.panel.querySelector('[data-mls-menu-key="athena-help"]')), 'Marketing door is not immediately before Athena help');
  eq(r.legacyTab.hidden, true, 'legacy Premium Reviews rail remained visible');
  eq(r.legacyMenu.hidden, true, 'legacy Premium Reviews menu remained visible');
  r.document.body.removeChild(r.legacyTab); r.triggerMutation();
  r.document.body.appendChild(r.legacyTab); r.triggerMutation();
  eq(r.legacyTab.hidden, true, 'reinserted legacy Reviews rail escaped retirement');
  eq(r.reach.open('send'), 'open-send', 'non-review Patient Reach open route changed');
  eq(r.reach.send(), 'send', 'Patient Reach send flow changed');
  r.topbarMenu.focus();
  eq(r.reach.open('reviews', { invoker: r.topbarMenu }), true, 'Feature Directory review shortcut did not route to Marketing');
  ok(r.document.getElementById('mlsP1MktWorkspace'), 'Marketing workspace did not open');
  eq(r.panel.inert, true, 'modal left underlying classic menu interactive');
  eq(r.panel.getAttribute('aria-hidden'), 'true', 'modal left underlying classic menu in accessibility tree');
  const lateSibling = makeNode('div', r.document); r.document.body.appendChild(lateSibling); r.triggerMutation();
  eq(lateSibling.inert, true, 'late body sibling remained interactive behind Marketing modal');
  eq(lateSibling.getAttribute('aria-hidden'), 'true', 'late body sibling remained in the accessibility tree');
  for (const field of Object.values(r.ui).filter(el => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['number','checkbox'].includes(String(el.type || 'text').toLowerCase())))) {
    eq(field.getAttribute('data-mls-no-dictate'), '1', `text field ${field.id} is exposed to global dictation`);
    eq(field.getAttribute('spellcheck'), 'false', `text field ${field.id} retained remote spellcheck eligibility`);
    eq(field.getAttribute('autocomplete'), 'off', `text field ${field.id} retained autocomplete`);
    if (field.tagName === 'TEXTAREA') ok(field.__fpFmt && field.__fpFmt.mlsMarketingFence === true, `textarea ${field.id} is exposed to clinical formatted-note injection`);
  }
  door.focus();
  eq(r.reach.openReviews(), true, 'openReviews did not route to Marketing');
  eq(r.reach.openContext('reviews'), true, 'review context shortcut did not route to Marketing');

  r.ui.mlsP1MktWebsite.value = 'https://example.invalid';
  r.ui.mlsP1MktHours.value = 'Mon-Fri 8-5'; r.ui.mlsP1MktServices.value = 'Spine consultations'; r.ui.mlsP1MktPhotos.checked = true;
  r.ui.mlsP1MktAudit.click();
  ok(/listing readiness snapshot/.test(r.ui.mlsP1MktListingOutput.value), 'listing audit did not generate a polished output');
  eq(r.api.isDirty(), true, 'programmatic listing output was not marked dirty');
  const listingDraft = r.ui.mlsP1MktListingOutput.value;
  r.setConfirm(false); r.ui.mlsP1MktClose.click();
  ok(r.document.getElementById('mlsP1MktWorkspace'), 'declined dirty Close discarded workspace');
  eq(r.ui.mlsP1MktListingOutput.value, listingDraft, 'declined dirty Close erased draft');
  r.document.getElementById('mlsP1MktWorkspace').fire('keydown', { key: 'Escape' });
  ok(r.document.getElementById('mlsP1MktWorkspace'), 'declined dirty Escape discarded workspace');
  eq(r.api.revert(), false, 'direct revert erased dirty drafts');
  r.api.open(); eq(r.ui.mlsP1MktListingOutput.value, listingDraft, 'second open erased dirty workspace instead of focusing it');
  r.setConfirm(true);

  r.ui.mlsP1MktReplySentiment.value = 'positive'; r.ui.mlsP1MktReplyCategory.value = 'communication'; r.ui.mlsP1MktReplyTone.value = 'warm';
  r.ui.mlsP1MktDraftReply.click();
  ok(!/Please contact/.test(r.ui.mlsP1MktReplyOutput.value), 'positive reply oddly forced a private complaint call');
  r.ui.mlsP1MktReplySentiment.value = 'critical'; r.ui.mlsP1MktReplyCategory.value = 'wait time';
  r.ui.mlsP1MktDraftReply.click();
  ok(/wait time/.test(r.ui.mlsP1MktReplyOutput.value), 'structured review context did not shape reply');
  ok(!Object.prototype.hasOwnProperty.call(r.ui, 'mlsP1MktReview'), 'workspace retained a free-text review/PHI intake');

  r.ui.mlsP1MktCampaignChannel.value = 'Email'; r.ui.mlsP1MktCampaignMessage.value = ''; r.ui.mlsP1MktPlanCampaign.click();
  ok((r.ui.mlsP1MktCampaignOutput.value.match(/BLOCKED:/g) || []).length === 3, 'unchecked consent gate was not visibly blocked');
  ok(!/Reply STOP/.test(r.ui.mlsP1MktCampaignOutput.value) && /unsubscribe/.test(r.ui.mlsP1MktCampaignOutput.value), 'Email draft used SMS opt-out language');
  r.ui.mlsP1MktCampaignChannel.value = 'Text message'; r.ui.mlsP1MktPlanCampaign.click();
  ok(/Reply STOP/.test(r.ui.mlsP1MktCampaignOutput.value), 'text-message draft lacks channel-correct STOP language');
  r.ui.mlsP1MktAdBudget.value = '999999'; r.ui.mlsP1MktAdDays.value = '999'; r.ui.mlsP1MktPlanAds.click();
  ok(/Daily cap: \$10000\.00/.test(r.ui.mlsP1MktAdsOutput.value) && /Planning days: 365/.test(r.ui.mlsP1MktAdsOutput.value), 'ad budget preview did not enforce caps');

  r.ui.mlsP1MktAdsCopy.click(); eq(r.api.isDirty(), true, 'copy cleared dirty draft state');
  r.account.epoch = 2; r.resolveCopy();
  r.window.dispatch('mls:session-boundary', { nextAccount: '', epoch: 2 });
  eq(r.document.getElementById('mlsP1MktWorkspace'), null, 'logout boundary left workspace mounted');
  eq(door.hidden, true, 'logout boundary re-showed the door from stale shell identity');
  eq(door.disabled, true, 'logout boundary left stale door enabled');
  eq(calmDoor.hidden, true, 'logout boundary left Calm/Lite door visible');
  eq(Object.prototype.hasOwnProperty.call(r.panel, 'inert'), false, 'test fixture did not exercise prototype inert accessor');
  eq(r.panel.inert, false, 'boundary left underlying app inert');
  eq(r.panel.getAttribute('aria-hidden'), null, 'boundary did not restore underlying aria-hidden state');
  eq(lateSibling.inert, false, 'boundary left late body sibling inert');
  eq(lateSibling.getAttribute('aria-hidden'), null, 'boundary left late body sibling aria-hidden');
  eq(Object.values(r.ui).reduce((n, el) => n + Object.values(el.listeners).reduce((m, list) => m + list.length, 0), 0), 0, 'logout retained detached workspace listeners');

  r.account.epoch = 3; r.window.dispatch('mls:p1-marketing-identity-ready'); r.api.open();
  r.ui.mlsP1MktAdService.value = 'Synthetic service'; r.ui.mlsP1MktPlanAds.click(); eq(r.api.isDirty(), true, 'second open output was not dirty');
  r.ui.mlsP1MktClear.click(); eq(r.api.isDirty(), false, 'explicit Clear drafts did not clear dirty state');
  eq(r.ui.mlsP1MktAdsOutput.value, '', 'explicit Clear drafts retained generated output');

  r.api.revert();
  eq(r.legacyTab.hidden, false, 'revert did not restore a detached/reinserted legacy Reviews rail');
  eq(r.legacyTab.disabled, false, 'revert left a detached/reinserted legacy Reviews rail disabled');
  eq(r.legacyTab.style.display || '', '', 'revert left a detached/reinserted legacy Reviews rail hidden by inline style');
  eq(r.legacyTab.getAttribute('aria-hidden'), null, 'revert retained aria-hidden on detached/reinserted legacy Reviews rail');
  eq(r.legacyTab.getAttribute('tabindex'), null, 'revert retained tabindex on detached/reinserted legacy Reviews rail');
  eq(r.reach.open, r.originals.open, 'revert did not restore PatientReach.open');
  eq(r.reach.openReviews, r.originals.openReviews, 'revert did not restore openReviews');
  eq(r.reach.openContext, r.originals.openContext, 'revert did not restore openContext');
  eq(r.reach.send, r.originals.send, 'revert changed Patient Reach send');
  const newerOwner = { installed: true, version: 'mkt-p1-1.0.0', installToken: 'newer-owner' };
  r.window.__mlsP1Marketing = newerOwner;
  eq(r.api.open(), false, 'saved stale API reopened after a newer owner installed');
  eq(r.api.close(), false, 'saved stale API closed a newer owner workspace');
  eq(r.api.reconcile(), false, 'saved stale API reconciled duplicate UI after replacement');
  eq(r.api.allowed(), false, 'saved stale API retained role authority after replacement');
  eq(r.api.isDirty(), false, 'saved stale API reported newer owner draft state');
}

{
  const r = runtime('user'), calm = r.document.getElementById('mlsP1MktCalmDoor');
  r.toolsBtn.focus(); calm.click();
  ok(r.document.getElementById('mlsP1MktWorkspace'), 'Calm/Lite Marketing row did not open workspace');
  r.api.close();
  eq(r.document.activeElement, r.toolsBtn, 'Calm/Lite close did not restore visible Tools invoker focus');
  const door = r.document.getElementById('mlsP1MktDoor');
  r.topbarMenu.focus(); door.click(); r.api.close();
  eq(r.document.activeElement, r.topbarMenu, 'classic close did not restore visible Menu invoker focus');
  r.api.revert();
}

/* Patient Reach installs after Marketing, and can itself be hot-replaced. Each
   exact owner is wrapped once and restored only while our wrapper still owns it. */
{
  const r = runtime('user', { delayedReach: true });
  const first = r.reach, firstOpen = first.open, firstReviews = first.openReviews, firstContext = first.openContext;
  r.installReach(first);
  ok(first.open !== firstOpen && first.openReviews !== firstReviews && first.openContext !== firstContext, 'delayed Patient Reach owner was not reconciled');
  eq(first.open('reviews'), true, 'delayed Feature Directory review route did not open Marketing');
  const secondCalls = [];
  const second = { open(kind) { secondCalls.push(['open', kind]); return kind; }, openReviews() { secondCalls.push(['reviews']); }, openContext(kind) { secondCalls.push(['context', kind]); }, send() { return 'second-send'; } };
  const originals = { open: second.open, openReviews: second.openReviews, openContext: second.openContext };
  r.installReach(second);
  eq(first.open, firstOpen, 'Patient Reach replacement left old open wrapper installed');
  eq(first.openReviews, firstReviews, 'Patient Reach replacement left old reviews wrapper installed');
  eq(first.openContext, firstContext, 'Patient Reach replacement left old context wrapper installed');
  eq(second.open('reviews'), true, 'replacement Patient Reach review route did not open Marketing');
  r.api.close(); r.api.revert();
  eq(second.open, originals.open, 'revert did not restore replacement Patient Reach.open');
  eq(second.openReviews, originals.openReviews, 'revert did not restore replacement openReviews');
  eq(second.openContext, originals.openContext, 'revert did not restore replacement openContext');
}

ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\/api\/|console\./.test(source), 'workspace contains network, persistent-storage, or console code');
ok(!/mlsP1MktReview["']|Paste de-identified public review|var review\s*=/.test(source), 'workspace contains free-text review intake');
ok(!/\b(?:premium|hasAccess|access_expires)\b/.test(source), 'free workspace is gated by paid access');
ok(/connect-src 'none'/.test(showcase) && !/<script\b|<form\b/i.test(showcase), 'Marketing showcase can execute, submit, or connect');
ok(/href="\/1p\/"/.test(showcase) && !/\?tool=marketing/.test(showcase), 'showcase auto-opens Marketing instead of requiring Menu action');

async function verifyStaleClipboardReceiptIsolation() {
  const r = runtime('user'); r.api.open();
  r.ui.mlsP1MktAdService.value = 'Synthetic service'; r.ui.mlsP1MktPlanAds.click();
  r.ui.mlsP1MktAdsCopy.click();
  r.api.close(); r.api.open();
  r.ui.mlsP1MktReceipt.textContent = 'new workspace receipt'; r.ui.mlsP1MktReceipt.hidden = false;
  r.resolveCopy(); await Promise.resolve(); await Promise.resolve();
  eq(r.ui.mlsP1MktReceipt.textContent, 'new workspace receipt', 'late clipboard completion wrote into reopened same-account workspace');
  r.api.close(); r.api.revert();
}

verifyStaleClipboardReceiptIsolation().then(function () {
  console.log(`PASS 1p Marketing workspace runtime (${checks} assertions)`);
}, function (error) {
  console.error(error && error.stack || error); process.exitCode = 1;
});
