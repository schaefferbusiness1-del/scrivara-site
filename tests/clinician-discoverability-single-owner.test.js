'use strict';

/* Doctor-facing discoverability contract. These checks keep recurring launch
 * actions in one predictable home and ensure conditional state does not move
 * the top-bar geometry. No clinical data, browser, or network is involved. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const redesign = read('feat_mls_redesign.js');
const topbar = read('feat_mls_topbar_unify.js');
const command = read('feat_mls_command_palette.js');
const account = read('feat_athena_tooltip_dedupe.js');
const connect = read('mls-connect.js');
const staging = read('mls-connect.staging.js');
const stagingApp = read('ScribeFlow-staging.html');

function between(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, `missing ${label || startMarker} start marker`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, `missing ${label || endMarker} end marker`);
  return source.slice(start, end);
}

/* + New means creation. Ask, Find, and route navigation keep their own homes. */
const newMenu = between(redesign, '  function ensureNewBtn(){', '  function hideChrome(){', 'New menu');
const newLabels = [...newMenu.matchAll(/\['([^']+)',\s*function/g)].map(match => match[1]);
assert.deepStrictEqual(newLabels, ['New patient', 'New visit', 'New appointment'],
  '+ New must contain only the three creation actions');
for (const duplicate of ['Ask Copilot', 'Find anything', 'Waiting room']) {
  assert(!newMenu.includes(`['${duplicate}'`), `${duplicate} still competes inside + New`);
}

/* Back may become active/inactive, but its reserved 38px slot never appears or
 * disappears and therefore never pushes the title or Find field sideways. */
assert(redesign.includes('#mlsRdBackBtn{ display:flex; visibility:hidden; width:38px;'),
  'Back control no longer reserves stable top-bar geometry');
const backSync = between(redesign, '  function syncBackButton(){', '\n  function buildShell(){', 'back-button sync');
assert(!/style\.display\s*=\s*[^;]*(?:none|\?)/.test(backSync),
  'Back availability still changes layout display instead of visibility');
{
  const attrs = Object.create(null);
  const back = {
    style: {}, disabled: false, tabIndex: 0,
    setAttribute(name, value) { attrs[name] = String(value); }
  };
  const context = { window: { __mlsViewHist: { stack: [] } }, $: id => id === 'mlsRdBackBtn' ? back : null };
  vm.createContext(context);
  vm.runInContext(`${backSync}\nthis.syncBackButton=syncBackButton;`, context);
  context.syncBackButton();
  assert.deepStrictEqual(
    { display: back.style.display, visibility: back.style.visibility, disabled: back.disabled, tabIndex: back.tabIndex, ariaHidden: attrs['aria-hidden'] },
    { display: 'flex', visibility: 'hidden', disabled: true, tabIndex: -1, ariaHidden: 'true' }
  );
  context.window.__mlsViewHist.stack.push('patients');
  context.syncBackButton();
  assert.deepStrictEqual(
    { display: back.style.display, visibility: back.style.visibility, disabled: back.disabled, tabIndex: back.tabIndex, ariaHidden: attrs['aria-hidden'] },
    { display: 'flex', visibility: 'visible', disabled: false, tabIndex: 0, ariaHidden: 'false' }
  );
}

/* Account is the only visible owner of Settings and Sign out. Old rail nodes
 * remain fail-open rollback controls but are hidden once Account is mounted. */
assert(account.includes('id="mlsAccountMenuBtn"') && account.includes('Account &amp; security') && account.includes('Sign out'),
  'canonical Account menu is incomplete');
assert(account.includes("markHidden(byId('mlsRdUserChip'), 'account-menu');"),
  'a hot-reloaded rail account chip can still duplicate Settings');
assert(!redesign.includes("chip.id='mlsRdUserChip'"),
  'the current shell still creates a second clickable Settings identity chip');

/* One truthful Find owner: visible field, /, Ctrl/Cmd+K, and API all converge. */
const findLabel = 'Find patients and screens…';
const findAria = 'Find patients and screens';
assert(topbar.includes(`PQS_PLACEHOLDER = "${findLabel}"`) && topbar.includes(`PQS_ARIA_LABEL = "${findAria}"`),
  'top-bar Find label or accessible scope is inaccurate');
assert(redesign.includes(`se.placeholder='${findLabel}'`) && redesign.includes(`se.setAttribute('aria-label','${findAria}')`),
  'Editorial Calm overwrites canonical Find with a different or false scope');
assert(!redesign.includes('Find anything — patients, notes, codes…'),
  'the visible Find field still promises unsupported note/code search');
assert(stagingApp.includes('placeholder="Find patients and screens…" aria-label="Find patients and screens"'),
  'staging canonical Find advertises a different or broader index than it implements');

const commandFns = between(command, '  var _legacyCmdK =', '\n  function boot() {', 'Find shortcut functions');
const ensureButton = between(commandFns, '  function ensureBtn() {', '\n  }', 'retired Commands button') + '\n  }';
assert(ensureButton.includes('removeChild(stale)') && !ensureButton.includes('createElement'),
  'the command compatibility layer still creates a competing header button');
assert(command.includes('open: openCanonicalFind'), 'command API does not converge on canonical Find');
{
  let canonicalOpens = 0, prevented = 0, stopped = 0, removed = 0;
  const parent = { removeChild() { removed++; } };
  const stale = { parentNode: parent };
  const context = {
    BTN_ID: 'mlsCpalBtn', OV_ID: 'mlsCpalOverlay',
    window: { mlsQuickFind() { canonicalOpens++; } },
    isFn: value => typeof value === 'function',
    safe(fn) { try { return fn(); } catch (error) { return undefined; } },
    close() {}, open() { throw new Error('legacy palette opened despite canonical Find'); },
    $(id) { return id === 'mlsCpalBtn' ? stale : null; }
  };
  vm.createContext(context);
  vm.runInContext(`${commandFns}\nthis.onKey=onKey;this.ensureBtn=ensureBtn;`, context);
  context.ensureBtn();
  context.onKey({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'k', preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; }, stopPropagation() { throw new Error('weaker propagation stop used'); } });
  assert.deepStrictEqual({ canonicalOpens, prevented, stopped, removed }, { canonicalOpens: 1, prevented: 1, stopped: 1, removed: 1 });
}

/* The concatenated legacy module retains only an API compatibility shim; it
 * must never register another document capture owner in either deployment. */
for (const [name, bundle] of [['production', connect], ['staging', staging]]) {
  const legacy = between(bundle, '/* ---- module: feat_cmdk.js ---- */', '/* ---- module: feat_timeline.js ---- */', `${name} legacy Cmd-K module`);
  assert(legacy.includes('compatibilityOnly:true') && legacy.includes("owner:'canonical-find'"), `${name} legacy Cmd-K API is not compatibility-only`);
  assert(!legacy.includes("document.addEventListener('keydown', onKey, true)"), `${name} legacy Cmd-K still owns a capture listener`);
  assert(bundle.includes("V='cpal-1.0.5',api=window.__mlsCmdPalette") && bundle.includes("old.removeAttribute('data-mls-asset')"),
    `${name} cannot replace an already-mounted older Find compatibility asset in the same document`);
  assert(bundle.includes("V='1.0.10',api=window.__mlsTopbar"), `${name} cannot hot-upgrade the truthful Find field label`);
}

/* Same-document upgrade: an already-registered 3.2.1 listener can run before
 * the new one. Its overlay is retired synchronously; when the new listener is
 * first, stopImmediatePropagation prevents the old sibling from running. */
{
  let canonicalOpens = 0, legacyOpens = 0, legacyOverlay = null;
  const oldApi = { close() { legacyOverlay = null; } };
  const context = {
    BTN_ID: 'mlsCpalBtn', OV_ID: 'mlsCpalOverlay',
    window: { __mlsCmdK: oldApi, mlsQuickFind() { canonicalOpens++; } },
    isFn: value => typeof value === 'function',
    safe(fn) { try { return fn(); } catch (_) { return undefined; } },
    close() {}, open() { throw new Error('fallback palette opened'); },
    $(id) { return id === 'mlsCmdkOverlay' ? legacyOverlay : null; }
  };
  vm.createContext(context);
  vm.runInContext(`${commandFns}\nthis.currentFindKey=onKey;`, context);
  const oldListener = event => {
    legacyOpens++;
    legacyOverlay = { parentNode: { removeChild() { legacyOverlay = null; } } };
    event.stopPropagation();
  };
  function dispatch(order) {
    const event = {
      ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'k', immediate: false,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { this.immediate = true; }
    };
    for (const listener of order) { if (event.immediate) break; listener(event); }
  }
  dispatch([oldListener, context.currentFindKey]);
  assert.deepStrictEqual({ canonicalOpens, legacyOpens, legacyVisible: !!legacyOverlay }, { canonicalOpens: 1, legacyOpens: 1, legacyVisible: false },
    'old-first same-document event left two Find surfaces visible');
  dispatch([context.currentFindKey, oldListener]);
  assert.deepStrictEqual({ canonicalOpens, legacyOpens, legacyVisible: !!legacyOverlay }, { canonicalOpens: 2, legacyOpens: 1, legacyVisible: false },
    'new-first same-document event failed to suppress the old capture sibling');
}

/* The day strip owns pulling on every date. The central empty state is passive
 * guidance; provider-filter recovery remains a separate, correctly named act. */
const easyMarker = connect.indexOf('the effortless Visit tab  (__mlsEasyV32)', 15000);
const easyStart = connect.lastIndexOf('/*', easyMarker);
const easyEnd = connect.indexOf('F7  MLS EASY SYNC TRUTH', easyMarker);
assert(easyMarker >= 0 && easyStart >= 0 && easyEnd > easyStart, 'active canonical Easy engine boundary missing');
const easy = connect.slice(easyStart, easyEnd);
const empty = between(easy, '  function emptyTodayHtml() {', '\n  function wireEmptyToday() {', 'Easy empty state');
assert(!empty.includes('ez3PullNow'), 'Easy empty state still paints a competing pull button');
assert(empty.includes('id="ez3DayEmpty"') && empty.includes('Use the <b>📥 Pull</b> button above'),
  'passive empty state does not direct the doctor to the canonical pull owner');
assert(empty.includes('id="ez3AllProv"'), 'provider-filter recovery disappeared with pull deduplication');
assert(connect.includes("$('mlsDsPullBtn').onclick = startPull;"), 'selected-day strip lost its pull handler');
assert(!easy.includes("on('ez3PullNow'"), 'retired Easy pull still has an active handler');

/* Tour copy and Staff Prep must teach the same ownership model the UI uses. */
assert(connect.includes("view: 'visit', target: ['#mlsDsPullBtn']"), 'tour points to a retired or generic pull control');
assert(connect.includes("target: ['#mlsAccountMenuBtn']"), 'tour points Settings at the retired rail chip');
assert(topbar.includes('Staff prep & Athena month pull') && topbar.includes('mls:menu-staff-prep-request'),
  'Staff Prep is no longer Menu-owned');

console.log('PASS clinician discoverability: creation, Find, Account, pull, Staff Prep, and back geometry each have one stable owner');
