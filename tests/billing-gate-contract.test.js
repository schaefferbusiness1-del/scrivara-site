'use strict';

/* b941 (2026-08-07): the Superbill freezes an exact E/M + CPT payload and the
 * doctor carries it into athenaOne's billing slate. The ONLY thing standing
 * between a suggested code and that slate was _athenaCanonicalBilling, which
 * checks that a code is SHAPED like a code — five characters, at least one
 * digit — and nothing else. So a payload could reach the chart carrying an
 * add-on level with no primary (an automatic CO-B15 denial), fluoroscopic
 * guidance already inside the injection's own descriptor (CO-97), an office
 * visit on a procedure day with no modifier 25 (which does not reduce the visit
 * charge, it deletes it), or bilateral work with no modifier 50 (which pays a
 * third less and produces NO denial at all).
 *
 * This pins the gate that now stands there, and — the part that actually
 * matters — pins that it degrades honestly:
 *   - it never edits the doctor's codes and never appends a modifier;
 *   - a check that could NOT RUN never reads as a check that passed;
 *   - the canonical billing snapshot keeps its old shape, so every existing
 *     caller and the frozen-payload hash behave exactly as before.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const gate = fs.readFileSync(path.join(root, 'feat_mls_billing_gate.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

/* ---------------------------------------------------------------------------
 * 1. The canonical snapshot carries the structured line detail — WITHOUT
 *    changing the shape anything else depends on.
 * ------------------------------------------------------------------------- */
const canonicalSource = between(app, 'function _athenaCanonicalBilling(coding)', '/* One plan builder');
const canonicalBilling = Function(`${canonicalSource}\nreturn _athenaCanonicalBilling;`)();

{
  // The pre-existing contract, unchanged. If this moves, the frozen-payload
  // hash and every existing caller move with it.
  const frozen = canonicalBilling({
    em: '99214 — established patient visit',
    cpt: ['J3301 — injection medication', 'CPT 20610 — large joint injection', '99214 duplicate E/M'],
    icd: ['M5450', 'Z0000', 'U0710'],
  });
  assert.strictEqual(frozen.emCode, '99214');
  assert.deepStrictEqual(frozen.cptCodes, ['J3301', '20610']);
  assert.deepStrictEqual(frozen.invalid, []);
  assert(!frozen.cptCodes.some((c) => ['M5450', 'Z0000', 'U0710'].includes(c)),
    'diagnosis codes must still never leak into the typed billing snapshot');
}

{
  // Every code that reached cptCodes gets a line, so the check sees the whole
  // claim rather than only the parts that happened to carry structure.
  const frozen = canonicalBilling({
    em: '99214',
    cpt: [{ code: '64483', modifiers: ['50'], side: 'bilateral', units: 1, levels: ['L4-L5'] }, '64484'],
    icd: ['M5416'],
  });
  assert(Array.isArray(frozen.lines), 'the snapshot must carry structured lines');
  const byCode = Object.fromEntries(frozen.lines.map((l) => [l.code, l]));
  assert.deepStrictEqual(byCode['64483'].modifiers, ['50'], 'a structured modifier must survive the freeze');
  assert.strictEqual(byCode['64483'].side, 'bilateral');
  assert.deepStrictEqual(byCode['64483'].levels, ['L4-L5']);
  assert.deepStrictEqual(byCode['64484'].modifiers, [],
    'a bare string code carries no modifier and one must never be invented for it');
  assert(byCode['99214'], 'the E/M must appear as a line so the same-day check can see it');
  assert.deepStrictEqual(frozen.cptCodes, ['64483', '64484'], 'the legacy code list is unchanged');
}

{
  // A modifier is only ever carried from a STRUCTURED field. It is still never
  // parsed back out of prose at confirmation time.
  const frozen = canonicalBilling({ cpt: ['64483 with modifier 50 bilateral'] });
  assert.deepStrictEqual(frozen.cptCodes, ['64483']);
  assert.deepStrictEqual(frozen.lines.find((l) => l.code === '64483').modifiers, [],
    'a modifier must never be inferred from a description');
}

{
  // Conflicting populated aliases must still fail closed.
  const conflicting = canonicalBilling({ emCode: '99215', em: '99214', cptCodes: ['J3301'], cpt: ['20610'] });
  assert(conflicting.invalid.length >= 2, 'conflicting populated aliases must still fail closed');
}

/* ---------------------------------------------------------------------------
 * 2. The gate module itself.
 * ------------------------------------------------------------------------- */
{
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  // Executed with no document at all — exactly the hostile case where a
  // progressive-enhancement asset must simply not explode. `fetch` is left as
  // the real global so the network paths below can be stubbed on it.
  Function('window', 'document', gate)(sandbox.window, undefined);
  const api = sandbox.window.__mlsBillingGate;
  assert(api && api.installed, 'the gate must install even with no DOM available');
  for (const fn of ['validate', 'render', 'check', 'claimFrom', 'gateDecision', 'lastAudit', 'revert']) {
    assert.strictEqual(typeof api[fn], 'function', `the gate must expose ${fn}()`);
  }

  // --- claimFrom sends CODES AND NOTHING ELSE ---
  const claim = api.claimFrom(
    { icd: ['M54.16 — radiculopathy'], place_of_service: '11', patientName: 'Jane Doe', mrn: '99887' },
    { emCode: '99214', cptCodes: ['64483'], lines: [{ code: '64483', modifiers: ['50'], side: 'bilateral', units: 1, levels: [] }] }
  );
  const wire = JSON.stringify(claim);
  assert(!/Jane Doe/.test(wire), 'a patient name must never reach the billing endpoint');
  assert(!/99887/.test(wire), 'a medical record number must never reach the billing endpoint');
  assert.strictEqual(claim.em, '99214');
  assert.deepStrictEqual(claim.icd10, ['M54.16'.split(/[\s—:,-]/)[0]], 'diagnoses are sent as bare codes');
  assert.strictEqual(claim.pos, '11');
  assert.deepStrictEqual(claim.lines.find((l) => l.code === '64483').modifiers, ['50']);
  assert(claim.lines.some((l) => l.code === '99214'), 'the E/M must be on the claim so the same-day rule can fire');

  // --- gateDecision: the three states ---
  const clean = api.gateDecision({ checked: true, findings: [{ severity: 'warn', rule: 'x', message: 'm' }] });
  assert.strictEqual(clean.allow, true, 'a warning must not stop the doctor');

  const blocked = api.gateDecision({
    checked: true,
    findings: [{ severity: 'block', rule: 'addon_without_primary', message: '64484 cannot stand alone.', codes: ['64484', '64483'] }],
  });
  assert.strictEqual(blocked.allow, false, 'a hard finding must hold the payload');
  assert(/64484/.test(blocked.reason), 'the reason must name the code so it is actionable');

  // THE failure mode this whole design exists to avoid: a check that could not
  // run must not be indistinguishable from a check that passed.
  const notRun = api.gateDecision({ checked: false, reason: 'MLS could not reach the billing check.' });
  assert.strictEqual(notRun.allow, true, 'an outage must not stop the doctor working');
  assert.strictEqual(notRun.checked, false, 'and must never be reported as a passed check');
  assert(notRun.reason, 'an unrun check must say why');

  const missing = api.gateDecision(null);
  assert.strictEqual(missing.checked, false, 'no audit at all is also "not checked", never "clean"');

  // --- validate() resolves rather than rejecting, in every failure mode ---
  return Promise.resolve()
    .then(() => {
      sandbox.window.bkToken = () => '';
      return api.validate({}, { emCode: '99214', cptCodes: [], lines: [] });
    })
    .then((r) => {
      assert.strictEqual(r.checked, false, 'signed out means not checked');
      assert(/not the same as/i.test(r.reason), 'the wording must refuse to let "not checked" read as "clean"');
      sandbox.window.bkToken = () => 'tok';
      sandbox.window.bkBase = () => 'https://example.test';
      // A network failure must resolve to "unknown", never reject.
      global.fetch = () => Promise.reject(new Error('offline'));
      return api.validate({}, { emCode: '99214', cptCodes: ['64483'], lines: [{ code: '64483' }] });
    })
    .then((r) => {
      assert.strictEqual(r.checked, false);
      assert.strictEqual(r.decision, 'unknown');
      assert(/not the same as/i.test(r.reason));
      // A malformed response is also "unknown", not a pass.
      global.fetch = () => Promise.resolve({ json: () => Promise.reject(new Error('bad json')) });
      return api.validate({}, { emCode: '', cptCodes: ['64483'], lines: [{ code: '64483' }] });
    })
    .then((r) => {
      assert.strictEqual(r.checked, false, 'an unreadable response is not a passed check');
      // A real block comes back as a real block.
      global.fetch = () => Promise.resolve({
        json: () => Promise.resolve({
          ok: false, decision: 'block',
          findings: [{ severity: 'block', rule: 'addon_without_primary', message: '64484 needs 64483.', codes: ['64484'], fix: 'Add 64483.' }],
          coverage: { checkedCount: 1, totalCount: 1, codesUnchecked: [] },
        }),
      });
      return api.validate({}, { emCode: '', cptCodes: ['64484'], lines: [{ code: '64484' }] });
    })
    .then((r) => {
      assert.strictEqual(r.checked, true);
      assert.strictEqual(r.decision, 'block');
      const d = api.gateDecision(r);
      assert.strictEqual(d.allow, false);
    })
    .then(() => { delete global.fetch; runSourcePins(); });
}

/* ---------------------------------------------------------------------------
 * 3. The wiring in the app page.
 * ------------------------------------------------------------------------- */
function runSourcePins() {
  // The Superbill runs the check.
  const showSuperbill = between(app, 'function showSuperbill()', 'function runBillingCheck(');
  assert(/runBillingCheck\(c,\s*typedBilling\)/.test(showSuperbill),
    'opening the Superbill must run the billing check on the frozen payload');

  // The confirm path is gated, holds ONCE, and never blocks on an unrun check.
  const push = between(app, 'function pushSuperbillToAthena()', 'function pushHistoryNoteToAthena(id)');
  assert(/__mlsBillingGate/.test(push), 'the Athena confirm path must consult the billing gate');
  assert(/gateDecision/.test(push), 'the confirm path must use the gate decision, not re-derive one');
  assert(/_superbillCodingOverride/.test(push),
    'the gate must be overridable — a check that cannot be overridden gets worked around');
  assert(/Nothing changed in Athena/.test(push),
    'a held payload must state plainly that the chart was not touched');
  // gateDecision returns allow:true for an unrun check, so this branch can only
  // ever fire on a real block. Pin that the call site does not add its own
  // stricter test on top.
  assert(!/checked\s*===\s*false/.test(push),
    'the confirm path must not invent its own handling of an unrun check — gateDecision already fails open');

  // The override resets with every Superbill.
  const reset = between(app, 'function _athenaResetSuperbill(hide)', '/* Snapshot the executable');
  assert(/_superbillCodingOverride\s*=\s*false/.test(reset),
    'a coding override must never carry across visits');
  assert(/billCheck/.test(reset), 'the previous verdict must be cleared with the Superbill');

  // The frozen snapshot carries the lines through to the confirm path.
  assert(/frozenBilling=\{emCode:[^}]*lines:/.test(app.replace(/\s+/g, ' ')) || /lines:\(typedBilling\.lines/.test(app),
    'the frozen billing payload must carry its structured lines');

  // The asset is actually loaded.
  assert(/feat_mls_billing_gate\.js/.test(connect), 'the gate must be loaded by mls-connect.js');
  const loader = between(connect, '=== Billing correctness gate loader', 'Revert: remove this loader');
  assert(/data-mls-asset/.test(loader), 'the loader must follow the shared asset-injection pattern');
  assert(/\?v=/.test(loader), 'the asset must be version-pinned like its siblings');

  /* ---------------------------------------------------------------------
   * 4. The gate must never quietly change the doctor's coding.
   * ------------------------------------------------------------------- */
  assert(!/lines\[[^\]]*\]\.modifiers\.push/.test(gate) && !/modifiers\.push\(/.test(gate),
    'the gate must never append a modifier — 25 and KX assert facts only the doctor can know');
  assert(!/currentCoding\s*=/.test(gate), 'the gate must never write back into the coding state');
  assert(/no PHI/i.test(gate) || /never crosses/i.test(gate),
    'the module must document its own privacy boundary');

  /* ---------------------------------------------------------------------
   * 5. The at-a-glance Superbill estimate must not contradict the Pay Report
   *    without saying why.
   * ------------------------------------------------------------------- */
  const feeTable = between(app, 'const FEE_TABLE={', '};');
  assert(/'64493':/.test(feeTable), 'the lumbar facet code must be present — it was missing entirely');
  assert(/64490.*CERVICAL\/THORACIC/i.test(feeTable),
    '64490 is the cervical/thoracic facet code and was mislabelled lumbar');
  const caption = between(app, "Ballpark national estimate", '</div>');
  assert(/no bilateral uplift/.test(caption) && /multiple-procedure reduction/.test(caption),
    'the ballpark caption must say which adjustments it does NOT apply');
  assert(/reads HIGH/.test(caption),
    'the caption must say which DIRECTION it is wrong in — "may vary" tells the doctor nothing');

  console.log('PASS billing gate: the canonical snapshot carries modifiers and laterality without changing its existing shape, the Superbill runs the check and holds a denying payload once, an unrun check never reads as a passed one, no patient data crosses the endpoint, and the gate never edits the doctor\'s codes.');
}
