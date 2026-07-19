'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const start = source.indexOf("var VER = '3.7.3'");
const end = source.indexOf('/* =========================================================================\n * MLS Scribe — PULL PIPELINE TRUTH PACK', start);
assert(start >= 0 && end > start, 'active Easy 3.7.3 owner was not found');
const active = source.slice(start, end);

function functionBlock(input, name) {
  const fnStart = input.indexOf(`function ${name}(`);
  assert(fnStart >= 0, `missing function ${name}`);
  const brace = input.indexOf('{', fnStart);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return input.slice(fnStart, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function luminance(hex) {
  const channels = hex.replace('#', '').match(/.{2}/g).map(part => parseInt(part, 16) / 255);
  const linear = channels.map(value => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// The active owner must outrank the earlier !important tint and remain AA in
// both collapsed and expanded states.
assert(active.includes('#mlsEz3 .ez3-prow .moredots{'), 'active More action does not match the theme override selector weight');
assert(active.includes('background:#F4FBF7 !important;') && active.includes('color:#153C2D !important;'),
  'collapsed More action does not own its foreground/background colors');
assert(active.includes('.moredots[aria-expanded="true"]{background:#2E6A4B !important;') && active.includes('color:#fff !important;'),
  'expanded Close action does not expose its high-contrast state');
assert(contrast('#F4FBF7', '#153C2D') >= 4.5, 'collapsed Open action contrast is below WCAG AA');
assert(contrast('#2E6A4B', '#FFFFFF') >= 4.5, 'expanded Close action contrast is below WCAG AA');

// Render the real row function in both states: the visible label and ARIA
// state change, while the delegated data-more key remains identical.
{
  const context = {
    S: { mode: 'doctor', expanded: null },
    statusOf() { return 'Booked'; },
    rowKey() { return 'appt-17'; },
    guardInfo() { return { on: true, blocked: 0 }; },
    esc(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); },
    dobLabel() { return 'DOB 01/02/1980'; },
    t12() { return '9:00 AM'; },
    visitType() { return 'Office visit'; }
  };
  vm.createContext(context);
  vm.runInContext(`${functionBlock(active, 'rowHtml')}\nthis.rowHtml = rowHtml;`, context);

  const closed = context.rowHtml({ name: 'Ada Example', provider: 'Dr Example' });
  assert(closed.includes('data-more="appt-17"'), 'collapsed Open action lost delegated data-more ownership');
  assert(closed.includes('aria-expanded="false"'), 'collapsed Open action does not expose aria-expanded=false');
  assert(closed.includes('aria-label="Open actions for Ada Example"') && closed.includes('>Open</button>'),
    'collapsed action is not visibly and accessibly labeled Open');

  context.S.expanded = 'appt-17';
  const open = context.rowHtml({ name: 'Ada Example', provider: 'Dr Example' });
  assert(open.includes('data-more="appt-17"'), 'expanded Close action lost delegated data-more ownership');
  assert(open.includes('aria-expanded="true"'), 'expanded Close action does not expose aria-expanded=true');
  assert(open.includes('aria-label="Close actions for Ada Example"') && open.includes('>Close</button>'),
    'expanded action is not visibly and accessibly labeled Close');
}

assert(active.includes("if ((el = t.closest('[data-more]')))"), 'delegated More action handler is missing');
assert(active.includes('S.expanded = (S.expanded === km ? null : km); render(); return;'),
  'delegated More action no longer toggles and re-renders its row');

// The Easy proxy is absent until the hardened exact-patient portal control is
// connected for the current patient. A stale patient-specific receipt fails
// closed, and openPortalInvite re-checks it at click time.
{
  let activePatient = null;
  let button = null;
  let clicks = 0;
  const toasts = [];
  const context = {
    window: { activePatient() { return activePatient; } },
    $(id) { return id === 'mlsPortalInviteBtn' ? button : null; },
    isFn(value) { return typeof value === 'function'; },
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
    toast(message) { toasts.push(message); }
  };
  vm.createContext(context);
  vm.runInContext([
    functionBlock(active, 'portalInviteReady'),
    functionBlock(active, 'portalActionHtml'),
    functionBlock(active, 'openPortalInvite'),
    'this.portalInviteReady = portalInviteReady;',
    'this.portalActionHtml = portalActionHtml;',
    'this.openPortalInvite = openPortalInvite;'
  ].join('\n'), context);

  assert.strictEqual(context.portalInviteReady(), false, 'portal proxy became ready without a hardened control');
  assert.strictEqual(context.portalActionHtml(), '', 'home/choose portal markup rendered without an exact active patient');

  activePatient = { id: 'A', name: 'Ada Example', dob: '01/02/1980' };
  button = {
    title: 'Open the patient portal for Ada Example. Nothing sends until you click Send login.',
    getAttribute(name) { return name === 'aria-label' ? 'not-the-hardened-owner' : null; },
    click() { clicks++; }
  };
  assert.strictEqual(context.portalInviteReady(), false, 'an unowned same-ID portal control enabled the Easy proxy');

  button.getAttribute = name => name === 'aria-label' ? 'Open patient portal invite for the active patient' : null;
  assert.strictEqual(context.portalInviteReady(), true, 'exact hardened portal receipt was rejected');
  assert(context.portalActionHtml().includes('id="ez3Portal"'), 'exact active patient did not receive the Easy portal proxy');
  context.openPortalInvite();
  assert.strictEqual(clicks, 1, 'Easy portal proxy did not delegate to the hardened owner');

  activePatient = { id: 'B', name: 'Grace Example', dob: '03/04/1981' };
  assert.strictEqual(context.portalInviteReady(), false, 'stale patient-specific portal receipt remained available after a patient switch');
  assert.strictEqual(context.portalActionHtml(), '', 'stale portal receipt still rendered the Easy proxy');
  context.openPortalInvite();
  assert.strictEqual(clicks, 1, 'stale portal receipt was clicked after a patient switch');
  assert.strictEqual(toasts.length, 1, 'fail-closed portal click did not explain how to restore the action');
}

const home = functionBlock(active, 'renderHome');
const choose = functionBlock(active, 'renderChoose');
const poll = functionBlock(active, 'startPoll');
assert(home.includes('portalActionHtml()') && !home.includes('id="ez3Portal"'), 'home still emits an unconditional portal proxy');
assert(choose.includes('portalActionHtml()') && !choose.includes('id="ez3Portal"'), 'choose still emits an unconditional portal proxy');
assert(poll.includes("(S.screen === 'home' || S.screen === 'choose')") && poll.includes('portalInviteReady() !== !!S._portalReady'),
  'home/choose do not reconcile when the exact portal receipt appears or disappears');

console.log('PASS Easy owner visible affordances: Open/Close is high-contrast and stateful; portal is exact-patient receipt-gated');
