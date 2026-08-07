'use strict';
/* =========================================================================
   A COLLAPSED DRAFT-ALL PANEL MUST STILL SAY A NOTE FAILED
   -------------------------------------------------------------------------
   OWNER: "the thing at the top when drafting all the op notes for a whole day
   that gives u the report as your going should be colapsible and a clean
   loading bar with an expandible part that shows that."

   Collapsible is the easy half. The dangerous half is that a doctor drafting a
   whole day will collapse the panel and walk away — and a run where two notes
   failed must not look identical to a run where none did. That is the same
   defect class as the pull panel rendering IN-PROGRESS as FAILED, and as the
   refusal that pointed at a blank the repaint then destroyed: a state the
   surface cannot express is a state the doctor never learns about.

   THE RULE THIS FILE DEFENDS:
     1. Collapsing hides the PER-ROW LIST and nothing that carries a verdict.
     2. The failure strip lives OUTSIDE that list, so collapsing cannot hide it,
        and it NAMES the patients — "2 failed" sends him hunting through 19 rows.
     3. A clean run clears the strip, so it can never cry wolf.
     4. Patient names are escaped — this HTML is built by concatenation.

   Driven, not grepped: the shipped paintLedger is lifted out and executed
   against a stub DOM. A grep for "tpfLedgerFails" would pass on a build where
   the strip is rendered INSIDE the collapsed container and therefore invisible.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}

/* ---------- lift the SHIPPED renderer out ------------------------------- */
const fnMark = 'function paintLedger(states, doneN, total, headline) {';
const fnAt = SRC.indexOf(fnMark);
ok(fnAt > 0, 'paintLedger is shipped in mls-connect.js');
if (fnAt < 0) { console.log('\nFAIL  draft-all-panel: renderer not found.'); process.exit(1); }
ok(SRC.indexOf(fnMark, fnAt + 1) < 0, 'exactly one paintLedger ships (no dormant twin drifting)');

let depth = 0, end = -1;
for (let i = SRC.indexOf('{', fnAt); i < SRC.length; i++) {
  const ch = SRC[i];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
ok(end > fnAt, 'the renderer body brace-matches (extract is complete, not truncated)');
const region = SRC.slice(fnAt, end);

/* ---------- the smallest DOM that can tell the truth --------------------- */
function makeEl(id) {
  return {
    id: id,
    innerHTML: '',
    textContent: '',
    className: '',
    style: {},
    _classes: new Set(),
    classList: {
      add: function (c) { this._o._classes.add(c); },
      remove: function (c) { this._o._classes.delete(c); },
      contains: function (c) { return this._o._classes.has(c); },
    },
    querySelector: function () { return null; },
  };
}
function wire(el) { el.classList._o = el; return el; }

function run(states, opts) {
  opts = opts || {};
  const box = wire(makeEl('tpfLedger'));
  const list = wire(makeEl('tpfLedgerList'));
  const fails = wire(makeEl('tpfLedgerFails'));
  const bar = wire(makeEl('tpfBarIn'));
  const stat = { textContent: '' };
  box.querySelector = function (sel) { return sel === '.tpf-lstat' ? stat : null; };
  if (opts.collapsed) box.classList.add('tpf-collapsed');

  const byId = { tpfLedger: box, tpfLedgerList: list, tpfLedgerFails: fails, tpfBarIn: bar };
  const factory = new Function('$', 'esc', 'ledgerEl', 'setBar',
    region + '\n; return paintLedger;');
  const paintLedger = factory(
    function (id) { return byId[id] || null; },
    function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    function () { return box; },
    function (pct) { bar.style.width = Math.max(0, Math.min(100, pct)) + '%'; }
  );
  paintLedger(states, opts.doneN || 0, opts.total || states.length, opts.headline || '');
  return { box, list, fails, bar, stat };
}

const S = (name, st, msg) => ({ name: name, day: '', st: st, msg: msg || '' });

/* ---------- 1. a failure is visible WITHOUT expanding -------------------- */
console.log('a collapsed panel still surfaces a failed note:');
{
  const r = run([S('Alice Alpha', 'ok'), S('Bram Bravo', 'fail', 'template did not resolve'), S('Cleo Charlie', 'ok')],
    { collapsed: true, doneN: 3, total: 3 });
  ok(r.box.classList.contains('tpf-collapsed'), 'the panel is genuinely collapsed for this run');
  ok(r.fails.className === 'on', 'the failure strip is switched ON while collapsed');
  ok(/Bram Bravo/.test(r.fails.innerHTML), 'it NAMES the patient whose note failed',
    'a bare count makes him hunt through the whole day');
  ok(/1 note failed/.test(r.fails.innerHTML), 'it says how many, in words that read as a verdict');
  ok(/open Details/.test(r.fails.innerHTML), 'and tells him where the reason is');
}

/* ---------- 2. a clean run never cries wolf ----------------------------- */
console.log('a clean run leaves the strip silent:');
{
  const r = run([S('Alice Alpha', 'ok'), S('Cleo Charlie', 'ok')], { collapsed: true, doneN: 2, total: 2 });
  ok(r.fails.className !== 'on', 'the failure strip stays OFF when nothing failed');
  ok(r.fails.innerHTML === '', 'and carries no stale text from an earlier run');
}

/* ---------- 3. it CLEARS when a retry succeeds -------------------------- */
console.log('a retry that succeeds clears the warning:');
{
  const first = run([S('Bram Bravo', 'fail', 'nope')], { collapsed: true });
  ok(first.fails.className === 'on', 'precondition: the strip is on after the failure');
  const second = run([S('Bram Bravo', 'ok', 'drafted')], { collapsed: true });
  ok(second.fails.className !== 'on', 'a later clean repaint turns it back off',
    'a warning that cannot clear is a warning he learns to ignore');
}

/* ---------- 4. names are escaped ---------------------------------------- */
console.log('names are escaped (this HTML is concatenated):');
{
  const r = run([S('<img src=x onerror=alert(1)>', 'fail')], { collapsed: true });
  ok(!/<img/.test(r.fails.innerHTML), 'a script-shaped patient name cannot inject markup');
  ok(/&lt;img/.test(r.fails.innerHTML), 'it is rendered as visible text instead');
}

/* ---------- 5. expanded still works, and the bar still moves ------------ */
console.log('expanded behaviour and the loading bar are unchanged:');
{
  const r = run([S('Alice Alpha', 'ok'), S('Bram Bravo', 'fail')], { collapsed: false, doneN: 1, total: 2 });
  ok(/Alice Alpha/.test(r.list.innerHTML) && /Bram Bravo/.test(r.list.innerHTML),
    'the per-row list still renders every row when expanded');
  ok(r.fails.className === 'on', 'the failure strip shows when expanded too (it is not collapse-only)');
  ok(r.bar.style.width === '50%', 'the progress bar reflects done/total');
}

/* ---------- 6. THE STRUCTURAL GUARANTEE --------------------------------- */
/* The strip is only safe if the collapsed CSS hides the LIST and not it. This
   cannot be executed in node — there is no layout — so it is asserted against
   the shipped stylesheet, which is where the mistake would actually be made. */
console.log('structural: collapsing hides the list, never the verdict:');
{
  ok(/#tpfLedger\.tpf-collapsed #tpfLedgerList\{display:none\}/.test(SRC),
    'collapsing hides the per-row list');
  const hidesFails = /#tpfLedger\.tpf-collapsed[^"]*#tpfLedgerFails[^"]*display:none/.test(SRC);
  ok(!hidesFails, 'NO collapsed rule hides the failure strip',
    'if this ever fails, a whole day can fail silently behind a collapsed panel');
  /* and the strip must be a SIBLING of the list, not a child of it */
  /* bounded by the insertBefore, NOT by the first ";" — inline style attributes
     in this markup contain semicolons and truncated the extract to 292 chars,
     which made this assertion fail against correct code */
  const mkAt = SRC.indexOf('led.innerHTML = ');
  const mkEnd = SRC.indexOf('row.parentElement.insertBefore', mkAt);
  const markup = mkAt > 0 && mkEnd > mkAt ? SRC.slice(mkAt, mkEnd) : '';
  ok(markup.length > 400, 'the ledger markup extract is complete, not truncated at an inline-style semicolon');
  const listAt = markup.indexOf('id="tpfLedgerList"');
  const failsAt = markup.indexOf('id="tpfLedgerFails"');
  ok(listAt > 0 && failsAt > listAt, 'the strip is mounted OUTSIDE and after the collapsible list');
  ok(/aria-expanded/.test(markup) && /aria-controls="tpfLedgerList"/.test(markup),
    'the toggle announces its state and what it controls');
}

console.log(failures === 0
  ? 'PASS draft-all panel: it collapses to a headline plus a clean bar, and a failed note still names itself without expanding'
  : 'FAIL draft-all-panel-collapses-without-hiding-failure: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
