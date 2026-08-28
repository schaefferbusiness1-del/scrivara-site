'use strict';

/* suspectvis-1.0.0 (2026-08-28) — the cross-patient-contamination alert was
 * display:none in the state the doctor normally sees the chart in.
 *
 * TWO independent causes, both required for the bug and both fixed here:
 *
 *  1. ANCHORING. _renderProfSuspectNotice and _renderProfUnpulledNotice each
 *     anchored themselves with card.querySelector('.prof-grid') and inserted
 *     before it. That is correct only until pf2 adopts .prof-grid into
 *     #pf2RecordsBody - after which the grid's PARENT is a collapsible fold
 *     body, so the notice was created INSIDE a fold that ships closed.
 *
 *  2. COLLAPSE ALLOWLIST. #profileCard.pf2-collapsed hides every direct child
 *     except an explicit allowlist, and the card ships COLLAPSED by default
 *     (localStorage 'mls_pf2_collapsed' defaults to '1'). #profImportSuspect
 *     was not on that list, so even a correctly-anchored alert was hidden.
 *
 * The alert is the ONLY surface warning that a chart's DOB/allergies/meds/
 * problems may belong to a different patient - the ~260 records flagged from
 * the 2026-06-24..06-29 pull window. A doctor opening one of those charts saw
 * nothing.
 *
 * This suite EXECUTES the anchoring helper against a DOM that reproduces the
 * post-pf2 shape, rather than grepping for the fix. A test that pins the
 * spelling of a selector would go green on a refactor that reintroduced the
 * bug.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];
const CONNECTS = ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'];

function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  const j = src.indexOf('{', i);
  let d = 0, e = -1;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced function ' + name);
  return src.slice(i, e);
}

/* ---- a DOM just large enough to run the helper honestly ---- */
class N {
  constructor(tag, id, cls) { this.tag = tag; this.id = id || ''; this.cls = cls || ''; this.children = []; this.parentNode = null; }
  appendChild(c) { if (c.parentNode) c.parentNode.remove(c); c.parentNode = this; this.children.push(c); return c; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.remove(c);
    const i = ref ? this.children.indexOf(ref) : -1;
    c.parentNode = this;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.children.indexOf(this);
    return i > 0 ? this.parentNode.children[i - 1] : null;
  }
  matches(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return (' ' + this.cls + ' ').includes(' ' + sel.slice(1) + ' ');
    return this.tag === sel;
  }
  querySelector(sel) {
    for (const c of this.children) {
      if (c.matches(sel)) return c;
      const d = c.querySelector(sel);
      if (d) return d;
    }
    return null;
  }
}

for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'latin1');

  const anchor = new Function(lift(src, '_mlsAnchorProfNotice') + '\nreturn _mlsAnchorProfNotice;')();

  /* THE BUG'S OWN SHAPE: pf2 has adopted .prof-grid into a collapsed fold body,
     so the grid's parent is NOT the card. */
  const card = new N('div', 'profileCard');
  card.appendChild(new N('h2'));
  const quick = card.appendChild(new N('div', 'pf2Quick'));
  const fold = card.appendChild(new N('div', 'pf2RecordsBody'));
  const grid = fold.appendChild(new N('div', '', 'prof-grid'));

  const el = new N('div', 'profImportSuspect');
  anchor(card, el);

  eq(el.parentNode, card,
    shell + ': the suspect alert was NOT anchored as a direct child of #profileCard - ' +
    'the collapse allowlist can only exempt direct children, so it would be hidden');
  ok(el.parentNode !== fold,
    shell + ': the alert was placed inside the collapsed fold body - this is the original bug');
  eq(card.children.indexOf(el) < card.children.indexOf(quick), true,
    shell + ': the alert must sit ABOVE the quick strip, which is the surface read while collapsed');

  /* RE-HOMING: an element created in the OLD position must be moved, because the
     bug reproduces by navigating from a warm chart to a suspect one. */
  const stale = fold.appendChild(new N('div', 'profImportSuspect'));
  eq(stale.parentNode, fold, shell + ': test setup failed to place a stale node');
  anchor(card, stale);
  eq(stale.parentNode, card,
    shell + ': a notice created in the pre-pf2 position was NOT re-homed to the card, so ' +
    'chart-to-chart navigation still buries the alert');

  /* IDEMPOTENT: running it again must not detach or duplicate. */
  const beforeLen = card.children.length;
  anchor(card, stale);
  eq(stale.parentNode, card, shell + ': re-anchoring detached the notice');
  eq(card.children.length, beforeLen, shell + ': re-anchoring duplicated the notice');

  /* The unpulled notice uses the same helper - prove BOTH notices are wired to it
     rather than to their own copy of the old .prof-grid logic. */
  const susBody = lift(src, '_renderProfSuspectNotice');
  const unpBody = lift(src, '_renderProfUnpulledNotice');
  for (const [nm, body] of [['_renderProfSuspectNotice', susBody], ['_renderProfUnpulledNotice', unpBody]]) {
    ok(body.includes('_mlsAnchorProfNotice(card,el)'),
      shell + ': ' + nm + ' does not use the shared anchor helper');
    ok(!/grid\.parentNode\.insertBefore\(el,grid\)/.test(body),
      shell + ': ' + nm + ' still anchors to .prof-grid\'s PARENT - that parent becomes a ' +
      'collapsed fold body once pf2 adopts the grid');
  }
}

/* The collapse allowlist must exempt the alert, in every derived lane. */
for (const cf of CONNECTS) {
  const file = path.join(root, cf);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'latin1');
  const m = src.match(/#profileCard\.pf2-collapsed > \*([^{]*)\{display:none!important;\}/);
  ok(m, cf + ': the pf2 collapse rule is missing entirely');
  ok(m[1].includes(':not(#profImportSuspect)'),
    cf + ': #profImportSuspect is NOT exempt from the pf2 collapse rule, so the ' +
    'cross-patient-contamination alert is display:none in the card\'s DEFAULT state');
  /* the two that were already exempt must stay exempt */
  ok(m[1].includes(':not(#profUnpulled)'), cf + ': #profUnpulled lost its collapse exemption');
  ok(m[1].includes(':not(#pvrPullOne)'), cf + ': the strip pull control lost its collapse exemption');
}

console.log('PASS suspect-notice-cannot-be-hidden: ' + checks + ' checks - the cross-patient ' +
  'contamination alert anchors as a direct child of the card, above the quick strip, is re-homed ' +
  'when stale, and is exempt from the default collapse in every lane');
